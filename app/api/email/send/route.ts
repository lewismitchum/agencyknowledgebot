import { NextRequest, NextResponse } from "next/server";
import { google } from "googleapis";
import { getDb } from "@/lib/db";
import { requireActiveMember } from "@/lib/authz";
import { enforceRateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

function b64urlEncode(input: string) {
  const b64 = Buffer.from(input, "utf8").toString("base64");
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function normalizeSubject(subject: string) {
  const s = (subject || "").trim();
  if (!s) return "Re:";
  if (/^re:/i.test(s)) return s;
  return `Re: ${s}`;
}

function extractHeader(headers: any[] | undefined, key: string) {
  const hit = headers?.find((h) => (h.name || "").toLowerCase() === key.toLowerCase());
  return String(hit?.value || "").trim();
}

function pickReplyTo(headers: any[] | undefined) {
  return extractHeader(headers, "Reply-To") || extractHeader(headers, "From");
}

function sanitizeBody(text: string) {
  return String(text || "").replace(/\r\n/g, "\n").trim();
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireActiveMember(req);

    // Corp only
    if (session.plan !== "corporation") {
      return NextResponse.json({ error: "Upgrade required." }, { status: 403 });
    }

    // Rate limit sends
    await enforceRateLimit({
      userId: session.userId,
      agencyId: session.agencyId,
      key: "email_send",
      perMinute: 5,
      perHour: 100,
    });

    const body = await req.json();
    const draftId = String(body?.draftId || "").trim();
    const threadId = String(body?.threadId || "").trim();
    const confirm = body?.confirm === true;
    const bodyOverride = body?.bodyOverride != null ? String(body.bodyOverride) : null;

    if (!confirm) {
      return NextResponse.json({ error: "Missing explicit confirmation. Send requires { confirm: true }." }, { status: 400 });
    }

    if (!draftId || !threadId) {
      return NextResponse.json({ error: "Missing draftId or threadId" }, { status: 400 });
    }

    const db = await getDb();

    // Drift-safe audit table
    await db.exec(`
      CREATE TABLE IF NOT EXISTS email_send_events (
        id TEXT PRIMARY KEY,
        agency_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        draft_id TEXT NOT NULL,
        thread_id TEXT NOT NULL,
        gmail_message_id TEXT,
        to_email TEXT,
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

    const draft = await db.get(
      `SELECT id, body, thread_id
       FROM email_drafts
       WHERE id = ? AND agency_id = ? AND user_id = ?`,
      [draftId, session.agencyId, session.userId]
    );

    if (!draft) {
      return NextResponse.json({ error: "Draft not found" }, { status: 404 });
    }

    if (String(draft.thread_id || "") !== threadId) {
      return NextResponse.json({ error: "Draft thread mismatch" }, { status: 400 });
    }

    const account = await db.get(
      `SELECT access_token, refresh_token, expiry_date
       FROM email_accounts
       WHERE user_id = ? AND agency_id = ?`,
      [session.userId, session.agencyId]
    );

    if (!account) {
      return NextResponse.json({ error: "No Gmail account connected" }, { status: 400 });
    }

    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    );

    oauth2Client.setCredentials({
      access_token: account.access_token,
      refresh_token: account.refresh_token,
      expiry_date: account.expiry_date,
    });

    const gmail = google.gmail({ version: "v1", auth: oauth2Client });

    const threadRes = await gmail.users.threads.get({
      userId: "me",
      id: threadId,
      format: "metadata",
      metadataHeaders: ["From", "Reply-To", "Subject", "Message-Id", "References", "In-Reply-To"],
    });

    const msgs = threadRes.data.messages || [];
    const last = msgs[msgs.length - 1];
    const headers = last?.payload?.headers || [];

    const toEmail = pickReplyTo(headers);
    const subject = normalizeSubject(extractHeader(headers, "Subject"));
    const messageId = extractHeader(headers, "Message-Id");
    const references = extractHeader(headers, "References");
    const inReplyTo = extractHeader(headers, "In-Reply-To");

    if (!toEmail) {
      return NextResponse.json({ error: "Could not determine recipient from thread" }, { status: 400 });
    }

    const usedOverride = bodyOverride != null && bodyOverride.trim().length > 0;
    const finalBody = sanitizeBody(usedOverride ? bodyOverride! : draft.body);

    if (!finalBody) {
      return NextResponse.json({ error: "Empty email body" }, { status: 400 });
    }

    const lines: string[] = [];
    lines.push(`To: ${toEmail}`);
    lines.push(`Subject: ${subject}`);
    lines.push(`MIME-Version: 1.0`);
    lines.push(`Content-Type: text/plain; charset="UTF-8"`);
    lines.push(`Content-Transfer-Encoding: 7bit`);

    if (messageId) lines.push(`In-Reply-To: ${messageId}`);
    if (references || messageId) {
      const refs = `${references ? references + " " : ""}${messageId || ""}`.trim();
      if (refs) lines.push(`References: ${refs}`);
    } else if (inReplyTo) {
      lines.push(`In-Reply-To: ${inReplyTo}`);
    }

    lines.push("");
    lines.push(finalBody);
    lines.push("");

    const raw = b64urlEncode(lines.join("\r\n"));

    const sendRes = await gmail.users.messages.send({
      userId: "me",
      requestBody: { raw, threadId },
    });

    const gmailMessageId = String(sendRes.data.id || "") || null;

    const eventId = crypto.randomUUID();
    await db.run(
      `INSERT INTO email_send_events
       (id, agency_id, user_id, draft_id, thread_id, gmail_message_id, to_email, subject, sent_body, used_override, created_at, raw_response)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        eventId,
        session.agencyId,
        session.userId,
        draftId,
        threadId,
        gmailMessageId,
        toEmail,
        subject,
        finalBody,
        usedOverride ? 1 : 0,
        Date.now(),
        JSON.stringify(sendRes.data || {}),
      ]
    );

    return NextResponse.json({
      ok: true,
      eventId,
      gmailMessageId,
      toEmail,
      subject,
      usedOverride,
    });
  } catch (err: any) {
    const msg = String(err?.message || "");
    if (msg.includes("Too many requests") || msg.includes("Hourly limit")) {
      return NextResponse.json({ error: msg }, { status: 429 });
    }
    console.error("Send email error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}