// app/api/email/threads/route.ts
import { NextRequest, NextResponse } from "next/server";
import { google } from "googleapis";
import { getDb } from "@/lib/db";
import { requireActiveMember } from "@/lib/authz";
import { enforceRateLimit } from "@/lib/rate-limit";
import { decrypt, encrypt } from "@/lib/crypto";

export const runtime = "nodejs";

function extractHeader(
  headers: Array<{ name?: string | null; value?: string | null }> | undefined,
  key: string,
) {
  if (!headers) return "";
  const hit = headers.find((h) => (h.name || "").toLowerCase() === key.toLowerCase());
  return String(hit?.value || "").trim();
}

function safeStr(x: any) {
  return String(x ?? "").trim();
}

function safeInt(x: any, fallback: number) {
  const n = Number(x);
  if (!Number.isFinite(n)) return fallback;
  return Math.floor(n);
}

function looksEncryptedToken(s: string) {
  // our format: ivB64.tagB64.dataB64
  const parts = String(s || "").split(".");
  return parts.length === 3 && parts.every((p) => p && p.length >= 8);
}

async function maybePersistRefreshedTokens(db: any, userId: string, agencyId: string, oauth2Client: any) {
  const cred = oauth2Client.credentials || {};
  const accessToken = cred.access_token ? String(cred.access_token) : null;
  const expiryDate = typeof cred.expiry_date === "number" ? cred.expiry_date : null;

  if (!accessToken && !expiryDate) return;

  const accessToStore = accessToken ? encrypt(accessToken) : null;

  await db.run(
    `UPDATE email_accounts
     SET access_token = COALESCE(?, access_token),
         expiry_date = COALESCE(?, expiry_date),
         updated_at = ?
     WHERE user_id = ? AND agency_id = ?`,
    [accessToStore, expiryDate, Date.now(), userId, agencyId],
  );
}

export async function GET(req: NextRequest) {
  try {
    const session = await requireActiveMember(req);

    // Corp only
    if (session.plan !== "corporation") {
      return NextResponse.json({ error: "Upgrade required." }, { status: 403 });
    }

    // Rate limit reads
    await enforceRateLimit({
      userId: session.userId,
      agencyId: session.agencyId,
      key: "email_read",
      perMinute: 30,
      perHour: 500,
    });

    const db = await getDb();

    // drift-safe (in case)
    await db.exec(`
      CREATE TABLE IF NOT EXISTS email_accounts (
        id TEXT PRIMARY KEY,
        agency_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        provider TEXT NOT NULL,
        email TEXT,
        access_token TEXT,
        refresh_token TEXT,
        expiry_date INTEGER,
        scope TEXT,
        token_type TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_email_accounts_agency_user
        ON email_accounts(agency_id, user_id);
    `);

    const account = await db.get(
      `SELECT access_token, refresh_token, expiry_date
       FROM email_accounts
       WHERE user_id = ? AND agency_id = ?`,
      [session.userId, session.agencyId],
    );

    if (!account) {
      return NextResponse.json({ error: "No Gmail account connected" }, { status: 400 });
    }

    // ✅ decrypt tokens (plaintext still works because decrypt() falls back)
    const accessToken = decrypt(String(account.access_token || "")) || "";
    const refreshToken = decrypt(String(account.refresh_token || "")) || "";

    if (!accessToken && !refreshToken) {
      return NextResponse.json({ error: "Gmail tokens missing. Reconnect Gmail." }, { status: 400 });
    }

    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI,
    );

    oauth2Client.setCredentials({
      access_token: accessToken || undefined,
      refresh_token: refreshToken || undefined,
      expiry_date: account.expiry_date ?? undefined,
    });

    const gmail = google.gmail({ version: "v1", auth: oauth2Client });

    const url = new URL(req.url);
    const maxResults = Math.min(50, Math.max(1, safeInt(url.searchParams.get("max") || "30", 30)));
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
        // ignore per-thread failures
      }
    }

    // ✅ persist refreshed access token encrypted
    await maybePersistRefreshedTokens(db, session.userId, session.agencyId, oauth2Client);

    // ✅ one-time migration helper: if refresh_token is still plaintext, encrypt it in-place
    // (Google won't re-issue refresh tokens often, so do it here lazily once)
    const storedRefresh = String(account.refresh_token || "");
    if (storedRefresh && !looksEncryptedToken(storedRefresh)) {
      await db.run(
        `UPDATE email_accounts
         SET refresh_token = ?, updated_at = ?
         WHERE user_id = ? AND agency_id = ?`,
        [encrypt(storedRefresh), Date.now(), session.userId, session.agencyId],
      );
    }

    return NextResponse.json({
      threads: out,
      nextPageToken: listRes.data.nextPageToken || null,
    });
  } catch (err: any) {
    const msg = String(err?.message || "");
    if (msg.includes("Too many requests") || msg.includes("Hourly limit")) {
      return NextResponse.json({ error: msg }, { status: 429 });
    }
    console.error("Email threads error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}