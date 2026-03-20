import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { requireActiveMember } from "@/lib/authz";
import { getDb, type Db } from "@/lib/db";
import { ensureSchema } from "@/lib/schema";
import { getAgencyPlan } from "@/lib/enforcement";
import { normalizePlan, requireFeature } from "@/lib/plans";
import { enforceRateLimit } from "@/lib/rate-limit";
import { getValidGmailClient } from "@/lib/email-google";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SendLead = {
  leadId?: string;
  to?: string;
  subject?: string;
  body?: string;
};

type Body = {
  campaignId?: string;
  leads?: SendLead[];
  confirm?: boolean;
};

function safeString(v: any) {
  return String(v ?? "").trim();
}

function splitEmails(input: string) {
  return safeString(input)
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

function b64urlEncodeUtf8(input: string) {
  const b64 = Buffer.from(input, "utf8").toString("base64");
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function isValidEmail(email: string) {
  const value = safeString(email).toLowerCase();
  if (!value) return false;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return false;
  if (
    value.includes("example.com") ||
    value.includes("test.com") ||
    value.includes("yourcompany.com") ||
    value.includes("domain.com")
  ) {
    return false;
  }
  return true;
}

async function dbAll(db: any, sql: string, args: any[] = []) {
  try {
    return await db.all(sql, ...args);
  } catch (err: any) {
    const msg = String(err?.message || "");
    if (
      msg.includes("Number of arguments mismatch") ||
      msg.includes("expected") ||
      msg.includes("mismatch")
    ) {
      return await db.all(sql, args);
    }
    throw err;
  }
}

async function ensureEmailTables(db: Db) {
  await db.exec(`
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
  `);

  const sendCols = (await dbAll(db, `PRAGMA table_info(email_send_events)`)) as Array<{ name?: string }>;
  const haveSend = new Set(sendCols.map((c) => String(c?.name || "").trim()));

  if (!haveSend.has("draft_id")) {
    await db.exec(`ALTER TABLE email_send_events ADD COLUMN draft_id TEXT`).catch(() => {});
  }
  if (!haveSend.has("thread_id")) {
    await db.exec(`ALTER TABLE email_send_events ADD COLUMN thread_id TEXT`).catch(() => {});
  }
  if (!haveSend.has("gmail_message_id")) {
    await db.exec(`ALTER TABLE email_send_events ADD COLUMN gmail_message_id TEXT`).catch(() => {});
  }
  if (!haveSend.has("to_email")) {
    await db.exec(`ALTER TABLE email_send_events ADD COLUMN to_email TEXT`).catch(() => {});
  }
  if (!haveSend.has("cc_email")) {
    await db.exec(`ALTER TABLE email_send_events ADD COLUMN cc_email TEXT`).catch(() => {});
  }
  if (!haveSend.has("bcc_email")) {
    await db.exec(`ALTER TABLE email_send_events ADD COLUMN bcc_email TEXT`).catch(() => {});
  }
  if (!haveSend.has("subject")) {
    await db.exec(`ALTER TABLE email_send_events ADD COLUMN subject TEXT`).catch(() => {});
  }
  if (!haveSend.has("sent_body")) {
    await db.exec(`ALTER TABLE email_send_events ADD COLUMN sent_body TEXT`).catch(() => {});
  }
  if (!haveSend.has("used_override")) {
    await db.exec(`ALTER TABLE email_send_events ADD COLUMN used_override INTEGER NOT NULL DEFAULT 0`).catch(() => {});
  }
  if (!haveSend.has("created_at")) {
    await db.exec(`ALTER TABLE email_send_events ADD COLUMN created_at INTEGER NOT NULL DEFAULT 0`).catch(() => {});
  }
  if (!haveSend.has("raw_response")) {
    await db.exec(`ALTER TABLE email_send_events ADD COLUMN raw_response TEXT`).catch(() => {});
  }

  await db.exec(`
    CREATE INDEX IF NOT EXISTS idx_email_send_events_agency_created
      ON email_send_events(agency_id, created_at);
  `);

  await db.exec(`
    CREATE INDEX IF NOT EXISTS idx_email_send_events_user_created
      ON email_send_events(user_id, created_at);
  `);

  const sendColsAfter = (await dbAll(db, `PRAGMA table_info(email_send_events)`)) as Array<{ name?: string }>;
  const haveSendAfter = new Set(sendColsAfter.map((c) => String(c?.name || "").trim()));

  if (haveSendAfter.has("thread_id")) {
    await db.exec(`
      CREATE INDEX IF NOT EXISTS idx_email_send_events_thread
        ON email_send_events(thread_id);
    `);
  }
}

function buildRawEmail(params: {
  fromEmail?: string | null;
  to: string[];
  subject: string;
  body: string;
}) {
  const lines: string[] = [];
  lines.push(`To: ${params.to.join(", ")}`);
  if (safeString(params.fromEmail || "")) {
    lines.push(`From: ${safeString(params.fromEmail || "")}`);
  }
  lines.push(`Subject: ${params.subject || "(no subject)"}`);
  lines.push(`MIME-Version: 1.0`);
  lines.push(`Content-Type: text/plain; charset="UTF-8"`);
  lines.push(`Content-Transfer-Encoding: 7bit`);
  lines.push("");
  lines.push(params.body);
  lines.push("");
  return b64urlEncodeUtf8(lines.join("\r\n"));
}

export async function OPTIONS() {
  return new Response(null, { status: 204 });
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireActiveMember(req);
    const db: Db = await getDb();
    await ensureSchema(db);
    await ensureEmailTables(db);

    const rawPlan = await getAgencyPlan(db, session.agencyId, session.plan);
    const planKey = normalizePlan(rawPlan);

    const emailGate = requireFeature(planKey, "email");
    if (!emailGate.ok) {
      return NextResponse.json(
        { ok: false, error: "Email inbox is available on Corporation.", code: "upgrade_required" },
        { status: 403 }
      );
    }

    await enforceRateLimit({
      userId: session.userId,
      agencyId: session.agencyId,
      key: "outreach_send",
      perMinute: 5,
      perHour: 100,
    });

    const body = (await req.json().catch(() => ({}))) as Body;
    const campaignId = safeString(body?.campaignId || "");
    const confirm = body?.confirm === true;
    const leads = Array.isArray(body?.leads) ? body.leads : [];

    if (!confirm) {
      return NextResponse.json(
        { ok: false, error: "Send requires { confirm: true }.", code: "confirm_required" },
        { status: 400 }
      );
    }

    if (!campaignId) {
      return NextResponse.json(
        { ok: false, error: "Missing campaignId", code: "missing_campaign_id" },
        { status: 400 }
      );
    }

    if (leads.length === 0) {
      return NextResponse.json(
        { ok: false, error: "No leads to send", code: "missing_leads" },
        { status: 400 }
      );
    }

    const campaign = (await db.get(
      `SELECT id
       FROM outreach_campaigns
       WHERE id = ? AND agency_id = ? AND user_id = ?
       LIMIT 1`,
      campaignId,
      session.agencyId,
      session.userId
    )) as { id: string } | undefined;

    if (!campaign?.id) {
      return NextResponse.json(
        { ok: false, error: "Campaign not found", code: "campaign_not_found" },
        { status: 404 }
      );
    }

    const gmailRes = await getValidGmailClient({
      agencyId: session.agencyId,
      userId: session.userId,
    });

    if (!gmailRes.ok) {
      const code =
        gmailRes.error === "NOT_CONNECTED"
          ? "not_connected"
          : gmailRes.error === "MISSING_TOKENS" || gmailRes.error === "MISSING_REFRESH_TOKEN"
            ? "missing_tokens"
            : gmailRes.error === "MISSING_GOOGLE_OAUTH_ENV"
              ? "missing_google_env"
              : "gmail_auth_error";

      const status =
        gmailRes.error === "NOT_CONNECTED" ||
        gmailRes.error === "MISSING_TOKENS" ||
        gmailRes.error === "MISSING_REFRESH_TOKEN"
          ? 409
          : 500;

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
        },
        { status }
      );
    }

    const gmail = gmailRes.gmail;
    const senderEmail = safeString(gmailRes.email || "");
    const now = new Date().toISOString();
    const createdAt = Date.now();

    const sent: Array<{
      leadId: string;
      gmailMessageId: string | null;
      threadId: string | null;
      toEmail: string;
      subject: string;
    }> = [];

    const skipped: Array<{ leadId: string; reason: string }> = [];

    for (const item of leads) {
      const leadId = safeString(item?.leadId || "");
      const requestedTo = safeString(item?.to || "");
      const requestedSubject = safeString(item?.subject || "");
      const bodyText = safeString(item?.body || "");

      if (!leadId || !bodyText) {
        skipped.push({
          leadId: leadId || "unknown",
          reason: !leadId ? "missing_lead_id" : "empty_body",
        });
        continue;
      }

      const dbLead = (await db.get(
        `SELECT id, email, status
         FROM outreach_leads
         WHERE id = ? AND campaign_id = ? AND agency_id = ? AND user_id = ?
         LIMIT 1`,
        leadId,
        campaignId,
        session.agencyId,
        session.userId
      )) as { id: string; email: string | null; status: string | null } | undefined;

      if (!dbLead?.id) {
        skipped.push({ leadId, reason: "lead_not_found" });
        continue;
      }

      const authoritativeEmail = safeString(dbLead.email || "");
      if (!isValidEmail(authoritativeEmail)) {
        skipped.push({ leadId, reason: "lead_email_not_verified_enough" });
        continue;
      }

      const toList = splitEmails(authoritativeEmail);
      if (toList.length === 0 || !toList.every(isValidEmail)) {
        skipped.push({ leadId, reason: "invalid_email" });
        continue;
      }

      const subject = requestedSubject || "Quick intro";
      const raw = buildRawEmail({
        fromEmail: senderEmail || null,
        to: toList,
        subject,
        body: bodyText,
      });

      try {
        const sendRes = await gmail.users.messages.send({
          userId: "me",
          requestBody: {
            raw,
          },
        });

        const gmailMessageId = safeString(sendRes?.data?.id || "") || null;
        const threadId = safeString(sendRes?.data?.threadId || "") || null;

        await db.run(
          `INSERT INTO email_send_events
           (id, agency_id, user_id, draft_id, thread_id, gmail_message_id, to_email, cc_email, bcc_email, subject, sent_body, used_override, created_at, raw_response)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          crypto.randomUUID(),
          session.agencyId,
          session.userId,
          null,
          threadId,
          gmailMessageId,
          authoritativeEmail,
          "",
          "",
          subject,
          bodyText,
          requestedTo && requestedTo !== authoritativeEmail ? 1 : 0,
          createdAt,
          JSON.stringify(sendRes?.data || {})
        );

        await db.run(
          `UPDATE outreach_leads
           SET status = 'sent',
               last_contacted_at = ?,
               updated_at = ?
           WHERE id = ? AND campaign_id = ? AND agency_id = ? AND user_id = ?`,
          now,
          now,
          leadId,
          campaignId,
          session.agencyId,
          session.userId
        );

        sent.push({
          leadId,
          gmailMessageId,
          threadId,
          toEmail: authoritativeEmail,
          subject,
        });
      } catch (sendErr: any) {
        console.error("OUTREACH_SINGLE_SEND_ERROR", {
          leadId,
          campaignId,
          message: String(sendErr?.message || sendErr),
        });

        skipped.push({
          leadId,
          reason: safeString(sendErr?.message || "gmail_send_failed") || "gmail_send_failed",
        });
      }
    }

    await db.run(
      `UPDATE outreach_campaigns
       SET updated_at = ?
       WHERE id = ? AND agency_id = ? AND user_id = ?`,
      now,
      campaignId,
      session.agencyId,
      session.userId
    );

    if (sent.length === 0) {
      return NextResponse.json(
        {
          ok: false,
          error: "No outreach emails were sent.",
          code: "nothing_sent",
          skipped,
        },
        { status: 400 }
      );
    }

    return NextResponse.json({
      ok: true,
      campaignId,
      sent,
      skipped,
      sentCount: sent.length,
      skippedCount: skipped.length,
      updatedAt: now,
    });
  } catch (err: any) {
    const msg = String(err?.message || "");
    if (msg.includes("Too many requests") || msg.includes("Hourly limit")) {
      return NextResponse.json(
        { ok: false, error: msg, code: "rate_limited" },
        { status: 429 }
      );
    }

    console.error("OUTREACH_SEND_ERROR", err);
    return NextResponse.json(
      {
        ok: false,
        error: "Internal server error",
        code: "internal",
        message: String(err?.message || err),
      },
      { status: 500 }
    );
  }
}