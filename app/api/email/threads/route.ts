// app/api/email/threads/route.ts
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

export async function GET(req: NextRequest) {
  try {
    const session = await requireActiveMember(req);

    // Corp only (no requireFeature helper in this repo)
    if (session.plan !== "corporation") {
      return NextResponse.json({ error: "Upgrade required." }, { status: 403 });
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

    const url = new URL(req.url);
    const maxResults = Math.min(30, Math.max(1, Number(url.searchParams.get("max") || "20")));
    const pageToken = safeStr(url.searchParams.get("pageToken"));
    const q = safeStr(url.searchParams.get("q"));

    const listRes = await gmail.users.threads.list({
      userId: "me",
      maxResults,
      pageToken: pageToken || undefined,
      q: q || undefined,
      includeSpamTrash: false,
    });

    const threadRefs = listRes.data.threads || [];
    const out: Array<{ id: string; subject: string; snippet: string; from: string; date: string }> = [];

    for (const t of threadRefs) {
      const id = safeStr(t.id);
      if (!id) continue;

      try {
        const tr = await gmail.users.threads.get({
          userId: "me",
          id,
          format: "metadata",
          metadataHeaders: ["From", "Date", "Subject"],
        });

        const messages = tr.data.messages || [];
        const last = messages[messages.length - 1];
        const headers = last?.payload?.headers || [];
        const subject = extractHeader(headers, "Subject");
        const from = extractHeader(headers, "From");
        const date = extractHeader(headers, "Date");
        const snippet = safeStr(last?.snippet || tr.data.snippet || "");

        out.push({ id, subject, snippet, from, date });
      } catch {
        // ignore
      }
    }

    await maybePersistRefreshedTokens(db, session.userId, session.agencyId, oauth2Client);

    return NextResponse.json({
      threads: out,
      nextPageToken: listRes.data.nextPageToken || null,
    });
  } catch (err: any) {
    console.error("Email threads error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}