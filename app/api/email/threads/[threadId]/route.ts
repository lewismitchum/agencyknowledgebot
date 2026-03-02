import { NextRequest, NextResponse } from "next/server";
import { google } from "googleapis";
import { getDb } from "@/lib/db";
import { requireActiveMember } from "@/lib/authz";

export const runtime = "nodejs";

function extractHeader(
  headers: Array<{ name?: string | null; value?: string | null }> | undefined,
  key: string
) {
  if (!headers) return "";
  const hit = headers.find((h) => (h.name || "").toLowerCase() === key.toLowerCase());
  return (hit?.value || "").trim();
}

function safeStr(x: any) {
  return String(x ?? "").trim();
}

function b64urlToUtf8(data: string) {
  if (!data) return "";
  const b64 = data.replace(/-/g, "+").replace(/_/g, "/");
  const padLen = (4 - (b64.length % 4)) % 4;
  const padded = b64 + "=".repeat(padLen);
  return Buffer.from(padded, "base64").toString("utf8");
}

function pickPlainText(payload: any): string {
  if (!payload) return "";

  const direct = payload?.body?.data ? b64urlToUtf8(String(payload.body.data)) : "";
  const mime = safeStr(payload?.mimeType);

  if (mime.toLowerCase().startsWith("text/plain") && direct) return direct;

  const parts: any[] = Array.isArray(payload?.parts) ? payload.parts : [];
  if (parts.length === 0) return direct || "";

  // Prefer text/plain
  for (const p of parts) {
    const pm = safeStr(p?.mimeType).toLowerCase();
    if (pm.startsWith("text/plain") && p?.body?.data) {
      return b64urlToUtf8(String(p.body.data));
    }
  }

  // Recurse multipart
  for (const p of parts) {
    const pm = safeStr(p?.mimeType).toLowerCase();
    if (pm.startsWith("multipart/")) {
      const nested = pickPlainText(p);
      if (nested) return nested;
    }
  }

  return "";
}

async function maybePersistRefreshedTokens(db: any, userId: string, agencyId: string, oauth2Client: any) {
  const cred = oauth2Client.credentials || {};
  const accessToken = cred.access_token ? String(cred.access_token) : null;
  const expiryDate = typeof cred.expiry_date === "number" ? cred.expiry_date : null;

  if (!accessToken && !expiryDate) return;

  await db.run(
    `UPDATE email_accounts
     SET access_token = COALESCE(?, access_token),
         expiry_date = COALESCE(?, expiry_date),
         updated_at = ?
     WHERE user_id = ? AND agency_id = ?`,
    [accessToken, expiryDate, Date.now(), userId, agencyId]
  );
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ threadId: string }> }) {
  try {
    const session = await requireActiveMember(req);

    // Corp only (no requireFeature helper in this repo)
    if (session.plan !== "corporation") {
      return NextResponse.json({ error: "Upgrade required." }, { status: 403 });
    }

    const { threadId: raw } = await ctx.params;
    const threadId = safeStr(raw);

    if (!threadId) {
      return NextResponse.json({ error: "Missing threadId" }, { status: 400 });
    }

    const db = await getDb();

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
      format: "full",
    });

    const messages = threadRes.data.messages || [];
    const outMsgs = messages
      .map((m: any) => {
        const headers = m?.payload?.headers || [];
        const subject = extractHeader(headers, "Subject");
        const from = extractHeader(headers, "From");
        const to = extractHeader(headers, "To");
        const date = extractHeader(headers, "Date");
        const snippet = safeStr(m?.snippet || "");
        const body = pickPlainText(m?.payload);

        return {
          id: safeStr(m?.id),
          from,
          to,
          date,
          subject,
          snippet,
          body,
        };
      })
      .filter((x: any) => x.id);

    const lastHeaders = messages[messages.length - 1]?.payload?.headers || [];
    const threadSubject =
      safeStr(extractHeader(lastHeaders, "Subject")) || safeStr(outMsgs[outMsgs.length - 1]?.subject) || "";

    await maybePersistRefreshedTokens(db, session.userId, session.agencyId, oauth2Client);

    return NextResponse.json({
      thread: {
        id: threadId,
        subject: threadSubject,
        messages: outMsgs,
      },
    });
  } catch (err: any) {
    console.error("Email thread get error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}