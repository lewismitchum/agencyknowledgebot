// app/api/email/send/route.ts
import { NextRequest, NextResponse } from "next/server";
import { requireActiveMember } from "@/lib/authz";
import { enforceRateLimit } from "@/lib/rate-limit";
import { getValidGmailClient } from "@/lib/email-google";
import { getDb, type Db } from "@/lib/db";
import { ensureSchema } from "@/lib/schema";
import { getAgencyPlan } from "@/lib/enforcement";
import { normalizePlan, requireFeature } from "@/lib/plans";
import crypto from "crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  draftId?: string;
  threadId?: string;
  confirm?: boolean;
  bodyOverride?: string | null;

  to?: string;
  cc?: string;
  bcc?: string;
  subject?: string;
  body?: string;
};

function safeString(v: any) {
  return String(v ?? "").trim();
}

function sanitizeError(err: any) {
  const message = String(err?.message || "");
  const name = String(err?.name || "");
  const code = (err?.code ?? err?.response?.data?.error?.status ?? err?.response?.status ?? undefined) as any;

  const googleReason =
    err?.response?.data?.error?.errors?.[0]?.reason ??
    err?.response?.data?.error?.status ??
    err?.errors?.[0]?.reason ??
    undefined;

  const status = (err?.response?.status ?? undefined) as any;

  return {
    name: name || undefined,
    message: message || undefined,
    code: code || undefined,
    status: status || undefined,
    googleReason: googleReason || undefined,
  };
}

function b64urlEncodeUtf8(input: string) {
  const b64 = Buffer.from(input, "utf8").toString("base64");
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function normalizeReplySubject(subject: string) {
  const s = safeString(subject);
  if (!s) return "Re:";
  if (/^re:/i.test(s)) return s;
  return `Re: ${s}`;
}

function extractHeader(headers: any[] | undefined, key: string) {
  const hit = headers?.find((h) => String(h?.name || "").toLowerCase() === key.toLowerCase());
  return safeString(hit?.value || "");
}

function pickReplyTo(headers: any[] | undefined) {
  return extractHeader(headers, "Reply-To") || extractHeader(headers, "From");
}

function sanitizeBody(text: string) {
  return safeString(String(text || "").replace(/\r\n/g, "\n"));
}

function splitEmails(input: string) {
  return safeString(input)
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

/**
 * Turso/libSQL wrappers vary:
 * - some expect db.get(sql, ...args) / db.run(sql, ...args)
 * - others expect db.get(sql, argsArray) / ...
 */
async function dbGet(db: any, sql: string, args: any[]) {
  try {
    return await db.get(sql, ...args);
  } catch (err: any) {
    const msg = String(err?.message || "");
    if (msg.includes("Number of arguments mismatch") || msg.includes("expected") || msg.includes("mismatch")) {
      return await db.get(sql, args);
    }
    throw err;
  }
}

async function dbRun(db: any, sql: string, args: any[]) {
  try {
    return await db.run(sql, ...args);
  } catch (err: any) {
    const msg = String(err?.message || "");
    if (msg.includes("Number of arguments mismatch") || msg.includes("expected") || msg.includes("mismatch")) {
      return await db.run(sql, args);
    }
    throw err;
  }
}

async function ensureEmailTables(db: Db) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS email_drafts (
      id TEXT PRIMARY KEY,
      agency_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      bot_id TEXT,
      thread_id TEXT,
      subject TEXT,
      body TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_email_drafts_agency_user_created
      ON email_drafts(agency_id, user_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_email_drafts_thread
      ON email_drafts(thread_id);

    CREATE TABLE IF NOT EXISTS email_send_events (
      id TEXT PRIMARY KEY,
      agency_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      draft_id TEXT,
      thread_id TEXT,
      gmail_message_id TEXT,
      to_email TEXT,
      cc_email TEXT,
      bcc_email TEXT,
      subject TEXT,
      sent_body TEXT,
      used_override INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      raw_response TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_email_send_events_agency_created
      ON email_send_events(agency_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_email_send_events_user_created
      ON email_send_events(user_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_email_send_events_thread
      ON email_send_events(thread_id);
  `);
}

export async function POST(req: NextRequest) {
  let where = "start";

  try {
    where = "requireActiveMember";
    const session = await requireActiveMember(req);

    where = "db";
    const db: Db = await getDb();
    await ensureSchema(db);
    await ensureEmailTables(db);

    where = "plan_gate";
    const rawPlan = await getAgencyPlan(db, session.agencyId, session.plan);
    const planKey = normalizePlan(rawPlan);
    const gate = requireFeature(planKey, "email");

    if (!gate.ok) {
      return NextResponse.json(
        { ok: false, error: "Email inbox is available on Corporation.", code: "upgrade_required" },
        { status: 403 }
      );
    }

    where = "rate_limit";
    await enforceRateLimit({
      userId: session.userId,
      agencyId: session.agencyId,
      key: "email_send",
      perMinute: 5,
      perHour: 100,
    });

    where = "body";
    const body = (await req.json().catch(() => ({}))) as Body;

    const draftId = safeString(body?.draftId || "");
    const threadId = safeString(body?.threadId || "");
    const confirm = body?.confirm === true;
    const bodyOverride = body?.bodyOverride != null ? String(body.bodyOverride) : null;

    const composeTo = safeString(body?.to || "");
    const composeCc = safeString(body?.cc || "");
    const composeBcc = safeString(body?.bcc || "");
    const composeSubject = safeString(body?.subject || "");
    const composeBody = body?.body != null ? String(body.body) : "";

    if (!confirm) {
      return NextResponse.json(
        { ok: false, error: "Send requires { confirm: true }.", code: "confirm_required" },
        { status: 400 }
      );
    }

    const isReplyMode = !!draftId || !!threadId;
    const isComposeMode = !!composeTo || !!composeSubject || !!composeBody;

    if (!isReplyMode && !isComposeMode) {
      return NextResponse.json(
        { ok: false, error: "Missing send payload", code: "missing_params" },
        { status: 400 }
      );
    }

    where = "gmail_auth_refresh";
    const gmailRes = await getValidGmailClient({ agencyId: session.agencyId, userId: session.userId });

    if (!gmailRes.ok) {
      const code =
        gmailRes.error === "NOT_CONNECTED"
          ? "not_connected"
          : gmailRes.error === "MISSING_TOKENS" || gmailRes.error === "MISSING_REFRESH_TOKEN"
            ? "missing_tokens"
            : gmailRes.error === "MISSING_GOOGLE_OAUTH_ENV"
              ? "missing_google_env"
              : "gmail_auth_error";

      const status = gmailRes.error === "NOT_CONNECTED" || gmailRes.error === "MISSING_TOKENS" ? 409 : 500;

      return NextResponse.json(
        {
          ok: false,
          error:
            gmailRes.error === "NOT_CONNECTED"
              ? "Not connected. Click Connect Gmail."
              : gmailRes.error === "MISSING_TOKENS" || gmailRes.error === "MISSING_REFRESH_TOKEN"
                ? "Gmail tokens missing. Reconnect Gmail."
                : "Gmail auth error.",
          code,
          where,
          details: gmailRes,
        },
        { status }
      );
    }

    const gmail = gmailRes.gmail;

    let finalTo = "";
    let finalCc = "";
    let finalBcc = "";
    let finalSubject = "";
    let finalBody = "";
    let gmailThreadId: string | null = null;
    let usedOverride = 0;

    if (isReplyMode) {
      if (!draftId || !threadId) {
        return NextResponse.json(
          { ok: false, error: "Missing draftId or threadId", code: "missing_params" },
          { status: 400 }
        );
      }

      where = "db_get_draft";
      const draft = await dbGet(
        db,
        `SELECT id, body, thread_id, subject
         FROM email_drafts
         WHERE id = ? AND agency_id = ? AND user_id = ?
         LIMIT 1`,
        [draftId, session.agencyId, session.userId]
      );

      if (!draft?.id) {
        return NextResponse.json({ ok: false, error: "Draft not found", code: "draft_not_found" }, { status: 404 });
      }

      if (safeString(draft.thread_id || "") !== threadId) {
        return NextResponse.json(
          { ok: false, error: "Draft thread mismatch", code: "thread_mismatch" },
          { status: 400 }
        );
      }

      where = "gmail_thread_metadata";
      const threadRes = await gmail.users.threads.get({
        userId: "me",
        id: threadId,
        format: "metadata",
        metadataHeaders: ["From", "Reply-To", "Subject", "Message-Id", "Message-ID", "References", "In-Reply-To"],
      });

      const msgs = threadRes.data.messages || [];
      const last = msgs[msgs.length - 1];
      const headers = last?.payload?.headers || [];

      finalTo = pickReplyTo(headers);
      finalSubject = normalizeReplySubject(extractHeader(headers, "Subject") || safeString(draft.subject || ""));
      finalBody = sanitizeBody(bodyOverride != null && safeString(bodyOverride).length > 0 ? bodyOverride : String(draft.body || ""));
      usedOverride = bodyOverride != null && safeString(bodyOverride).length > 0 ? 1 : 0;
      gmailThreadId = threadId;

      const messageId = extractHeader(headers, "Message-Id") || extractHeader(headers, "Message-ID");
      const references = extractHeader(headers, "References");
      const inReplyTo = extractHeader(headers, "In-Reply-To");

      if (!finalTo) {
        return NextResponse.json(
          { ok: false, error: "Could not determine recipient from thread", code: "missing_recipient" },
          { status: 400 }
        );
      }

      if (!finalBody) {
        return NextResponse.json({ ok: false, error: "Empty email body", code: "empty_body" }, { status: 400 });
      }

      const lines: string[] = [];
      lines.push(`To: ${finalTo}`);
      if (gmailRes.email) lines.push(`From: ${gmailRes.email}`);
      lines.push(`Subject: ${finalSubject}`);

      if (messageId) lines.push(`In-Reply-To: ${messageId}`);
      if (references || messageId) {
        const refs = `${references ? references + " " : ""}${messageId || ""}`.trim();
        if (refs) lines.push(`References: ${refs}`);
      } else if (inReplyTo) {
        lines.push(`In-Reply-To: ${inReplyTo}`);
      }

      lines.push(`MIME-Version: 1.0`);
      lines.push(`Content-Type: text/plain; charset="UTF-8"`);
      lines.push(`Content-Transfer-Encoding: 7bit`);
      lines.push("");
      lines.push(finalBody);
      lines.push("");

      where = "gmail_send_reply";
      const sendRes = await gmail.users.messages.send({
        userId: "me",
        requestBody: {
          raw: b64urlEncodeUtf8(lines.join("\r\n")),
          threadId,
        },
      });

      const gmailMessageId = safeString(sendRes?.data?.id || "") || null;

      where = "db_insert_event_reply";
      await dbRun(
        db,
        `INSERT INTO email_send_events
         (id, agency_id, user_id, draft_id, thread_id, gmail_message_id, to_email, cc_email, bcc_email, subject, sent_body, used_override, created_at, raw_response)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          crypto.randomUUID(),
          session.agencyId,
          session.userId,
          draftId,
          threadId,
          gmailMessageId,
          finalTo,
          "",
          "",
          finalSubject,
          finalBody,
          usedOverride,
          Date.now(),
          JSON.stringify(sendRes?.data || {}),
        ]
      );

      return NextResponse.json({
        ok: true,
        gmailMessageId,
        threadId,
        toEmail: finalTo,
        subject: finalSubject,
        usedOverride: usedOverride === 1,
      });
    }

    finalTo = composeTo;
    finalCc = composeCc;
    finalBcc = composeBcc;
    finalSubject = composeSubject;
    finalBody = sanitizeBody(composeBody);

    if (!finalTo) {
      return NextResponse.json({ ok: false, error: "Missing To", code: "missing_to" }, { status: 400 });
    }

    if (!finalBody) {
      return NextResponse.json({ ok: false, error: "Empty email body", code: "empty_body" }, { status: 400 });
    }

    const toList = splitEmails(finalTo);
    const ccList = splitEmails(finalCc);
    const bccList = splitEmails(finalBcc);

    const lines: string[] = [];
    lines.push(`To: ${toList.join(", ")}`);
    if (ccList.length) lines.push(`Cc: ${ccList.join(", ")}`);
    if (bccList.length) lines.push(`Bcc: ${bccList.join(", ")}`);
    if (gmailRes.email) lines.push(`From: ${gmailRes.email}`);
    if (finalSubject) lines.push(`Subject: ${finalSubject}`);
    lines.push(`MIME-Version: 1.0`);
    lines.push(`Content-Type: text/plain; charset="UTF-8"`);
    lines.push(`Content-Transfer-Encoding: 7bit`);
    lines.push("");
    lines.push(finalBody);
    lines.push("");

    where = "gmail_send_compose";
    const sendRes = await gmail.users.messages.send({
      userId: "me",
      requestBody: {
        raw: b64urlEncodeUtf8(lines.join("\r\n")),
      },
    });

    const gmailMessageId = safeString(sendRes?.data?.id || "") || null;
    gmailThreadId = safeString(sendRes?.data?.threadId || "") || null;

    where = "db_insert_event_compose";
    await dbRun(
      db,
      `INSERT INTO email_send_events
       (id, agency_id, user_id, draft_id, thread_id, gmail_message_id, to_email, cc_email, bcc_email, subject, sent_body, used_override, created_at, raw_response)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        crypto.randomUUID(),
        session.agencyId,
        session.userId,
        null,
        gmailThreadId,
        gmailMessageId,
        finalTo,
        finalCc,
        finalBcc,
        finalSubject,
        finalBody,
        0,
        Date.now(),
        JSON.stringify(sendRes?.data || {}),
      ]
    );

    return NextResponse.json({
      ok: true,
      gmailMessageId,
      threadId: gmailThreadId,
      toEmail: toList[0] || finalTo,
      subject: finalSubject,
      usedOverride: false,
    });
  } catch (err: any) {
    const msg = String(err?.message || "");
    if (msg.includes("Too many requests") || msg.includes("Hourly limit")) {
      return NextResponse.json({ ok: false, error: msg, code: "rate_limited", where: "rate_limit" }, { status: 429 });
    }

    console.error("Email send error:", err);
    return NextResponse.json(
      { ok: false, error: "Internal server error", code: "internal", where, details: sanitizeError(err) },
      { status: 500 }
    );
  }
}