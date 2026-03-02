import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireActiveMember } from "@/lib/authz";
import { google } from "googleapis";

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

function extractHeader(headers: any[], key: string) {
  const hit = headers?.find((h) => (h.name || "").toLowerCase() === key.toLowerCase());
  return (hit?.value || "").trim();
}

function pickReplyTo(headers: any[]) {
  return extractHeader(headers, "Reply-To") || extractHeader(headers, "From");
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireActiveMember(req);

    if (session.plan !== "corporation") {
      return NextResponse.json({ error: "Upgrade required." }, { status: 403 });
    }

    const { draftId, threadId, confirm } = await req.json();

    if (!confirm) {
      return NextResponse.json({ error: "Confirmation required." }, { status: 400 });
    }

    const db = await getDb();

    const draft = await db.get(
      `SELECT body, thread_id FROM email_drafts
       WHERE id = ? AND agency_id = ? AND user_id = ?`,
      [draftId, session.agencyId, session.userId]
    );

    if (!draft || draft.thread_id !== threadId) {
      return NextResponse.json({ error: "Draft mismatch." }, { status: 400 });
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

    oauth2Client.setCredentials(account);

    const gmail = google.gmail({ version: "v1", auth: oauth2Client });

    const threadRes = await gmail.users.threads.get({
      userId: "me",
      id: threadId,
      format: "metadata",
      metadataHeaders: ["From", "Subject", "Message-Id"],
    });

    const last = threadRes.data.messages?.slice(-1)[0];
    const headers = last?.payload?.headers || [];

    const toEmail = pickReplyTo(headers);
    const subject = normalizeSubject(extractHeader(headers, "Subject"));
    const messageId = extractHeader(headers, "Message-Id");

    const rawMessage = b64urlEncode(
      `To: ${toEmail}\r\n` +
        `Subject: ${subject}\r\n` +
        (messageId ? `In-Reply-To: ${messageId}\r\n` : "") +
        `Content-Type: text/plain; charset="UTF-8"\r\n\r\n` +
        draft.body
    );

    const sendRes = await gmail.users.messages.send({
      userId: "me",
      requestBody: { raw: rawMessage, threadId },
    });

    return NextResponse.json({
      ok: true,
      gmailMessageId: sendRes.data.id,
    });
  } catch (err: any) {
    console.error("Send email error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}