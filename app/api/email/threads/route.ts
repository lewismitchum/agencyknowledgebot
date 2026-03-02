// app/api/email/threads/route.ts
import { NextRequest, NextResponse } from "next/server";
import { google } from "googleapis";
import { getDb } from "@/lib/db";
import { requireActiveMember } from "@/lib/authz";
import { enforceRateLimit } from "@/lib/rate-limit";
import { decrypt } from "@/lib/crypto";

export const runtime = "nodejs";

function extractHeader(headers: any[] | undefined, key: string) {
  const hit = headers?.find((h) => String(h?.name || "").toLowerCase() === key.toLowerCase());
  return String(hit?.value || "").trim();
}

function safeInt(v: any, fallback: number) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function safeString(v: any) {
  return String(v ?? "").trim();
}

/**
 * Turso/libSQL wrappers vary:
 * - some expect db.get(sql, ...args)
 * - others expect db.get(sql, argsArray)
 *
 * This adapter supports both without touching your global db wrapper.
 */
async function dbGet(db: any, sql: string, args: any[]) {
  try {
    // Prefer spread form (most common with libsql wrappers)
    return await db.get(sql, ...args);
  } catch (err: any) {
    const msg = String(err?.message || "");
    // If the wrapper expects args array, retry once with array form
    if (msg.includes("Number of arguments mismatch") || msg.includes("expected") || msg.includes("mismatch")) {
      return await db.get(sql, args);
    }
    throw err;
  }
}

export async function GET(req: NextRequest) {
  try {
    const session = await requireActiveMember(req);

    // Corp only
    if (session.plan !== "corporation") {
      return NextResponse.json(
        { ok: false, upsell: { code: "upgrade_required", message: "Email inbox is available on Corporation." } },
        { status: 403 },
      );
    }

    await enforceRateLimit({
      userId: session.userId,
      agencyId: session.agencyId,
      key: "email_threads",
      perMinute: 30,
      perHour: 1500,
    });

    const url = new URL(req.url);
    const max = Math.min(50, Math.max(1, safeInt(url.searchParams.get("max"), 30)));
    const q = safeString(url.searchParams.get("q") || "");

    const db = await getDb();

    // Drift-safe email_accounts table (in case this route is hit before callback created it)
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

    const account = await dbGet(
      db,
      `SELECT access_token, refresh_token, expiry_date, email
       FROM email_accounts
       WHERE user_id = ? AND agency_id = ?`,
      [session.userId, session.agencyId],
    );

    if (!account) {
      return NextResponse.json(
        { ok: false, error: "Not connected. Click Connect Gmail.", code: "not_connected" },
        { status: 409 },
      );
    }

    const accessToken = decrypt(account.access_token) || "";
    const refreshToken = decrypt(account.refresh_token) || "";
    const expiryDate = account.expiry_date;

    if (!accessToken && !refreshToken) {
      return NextResponse.json(
        { ok: false, error: "Gmail tokens missing. Reconnect Gmail.", code: "missing_tokens" },
        { status: 409 },
      );
    }

    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI,
    );

    oauth2Client.setCredentials({
      access_token: accessToken || undefined,
      refresh_token: refreshToken || undefined,
      expiry_date: expiryDate || undefined,
    });

    const gmail = google.gmail({ version: "v1", auth: oauth2Client });

    const listRes = await gmail.users.threads.list({
      userId: "me",
      maxResults: max,
      q: q || undefined,
    });

    const threadIds = (listRes.data.threads || [])
      .map((t) => String(t?.id || "").trim())
      .filter(Boolean);

    // Fetch minimal metadata for each thread (subject/from/date/snippet)
    // NOTE: this is N calls; keep max <= 50 (we cap it).
    const threads = await Promise.all(
      threadIds.map(async (id) => {
        try {
          const tr = await gmail.users.threads.get({
            userId: "me",
            id,
            format: "metadata",
            metadataHeaders: ["From", "Subject", "Date"],
          });

          const msgs = tr.data.messages || [];
          const last = msgs[msgs.length - 1];
          const headers = last?.payload?.headers || [];

          const subject = extractHeader(headers, "Subject");
          const from = extractHeader(headers, "From");
          const date = extractHeader(headers, "Date");
          const snippet = safeString(tr.data.snippet || last?.snippet || "");

          return {
            id,
            subject,
            from,
            date,
            snippet,
          };
        } catch {
          return { id, subject: "", from: "", date: "", snippet: "" };
        }
      }),
    );

    return NextResponse.json({
      ok: true,
      email: account.email ?? null,
      threads: threads.filter((t) => t.id),
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