// app/api/email/oauth/callback/route.ts
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { google } from "googleapis";
import { randomUUID } from "crypto";
import { getDb, type Db } from "@/lib/db";
import { ensureSchema } from "@/lib/schema";
import { requireActiveMember } from "@/lib/authz";
import { encrypt } from "@/lib/crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function safeString(v: any) {
  return String(v ?? "").trim();
}

function parseState(state: string) {
  // state format from /api/email/connect: `s_${uuid}_${agencyId}_${userId}`
  const parts = safeString(state).split("_");
  if (parts.length < 4) return null;
  if (parts[0] !== "s") return null;

  const agencyId = parts[2];
  const userId = parts[3];

  if (!agencyId || !userId) return null;
  return { agencyId, userId };
}

async function ensureEmailAccountsSchema(db: Db) {
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
}

export async function GET(req: NextRequest) {
  try {
    // User should still be logged in when returning from Google
    const ctx = await requireActiveMember(req);

    const url = new URL(req.url);
    const code = safeString(url.searchParams.get("code"));
    const state = safeString(url.searchParams.get("state"));
    const error = safeString(url.searchParams.get("error"));

    if (error) {
      return NextResponse.redirect(new URL(`/app/email?connected=0&error=${encodeURIComponent(error)}`, req.url));
    }

    if (!code || !state) {
      return NextResponse.redirect(new URL(`/app/email?connected=0&error=missing_code_or_state`, req.url));
    }

    // CSRF: state must match httpOnly cookie set by /api/email/connect
    const cookieState = safeString(req.cookies.get("email_oauth_state")?.value);
    if (!cookieState || cookieState !== state) {
      return NextResponse.redirect(new URL(`/app/email?connected=0&error=state_mismatch`, req.url));
    }

    // state includes agencyId/userId — verify it matches current session
    const parsed = parseState(state);
    if (!parsed || parsed.agencyId !== ctx.agencyId || parsed.userId !== ctx.userId) {
      return NextResponse.redirect(new URL(`/app/email?connected=0&error=state_context_mismatch`, req.url));
    }

    const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "";
    const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || "";
    const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI || "";

    if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REDIRECT_URI) {
      return NextResponse.redirect(new URL(`/app/email?connected=0&error=missing_google_env`, req.url));
    }

    const oauth2Client = new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI);

    const tokenRes = await oauth2Client.getToken(code);
    const tokens = tokenRes.tokens || {};

    const accessToken = safeString(tokens.access_token);
    const refreshToken = safeString(tokens.refresh_token);
    const expiryDate = typeof tokens.expiry_date === "number" ? tokens.expiry_date : null;
    const scope = safeString(tokens.scope);
    const tokenType = safeString(tokens.token_type);

    if (!accessToken && !refreshToken) {
      return NextResponse.redirect(new URL(`/app/email?connected=0&error=missing_tokens`, req.url));
    }

    oauth2Client.setCredentials({
      access_token: accessToken || undefined,
      refresh_token: refreshToken || undefined,
      expiry_date: expiryDate ?? undefined,
    });

    // Fetch the connected Gmail address (best-effort)
    let email: string | null = null;
    try {
      const gmail = google.gmail({ version: "v1", auth: oauth2Client });
      const prof = await gmail.users.getProfile({ userId: "me" });
      email = safeString((prof.data as any)?.emailAddress) || null;
    } catch {
      email = null;
    }

    const db: Db = await getDb();
    await ensureSchema(db);
    await ensureEmailAccountsSchema(db);

    const now = Date.now();

    // Upsert by (agency_id, user_id)
    const existing = await db.get(
      `SELECT id FROM email_accounts WHERE agency_id = ? AND user_id = ?`,
      [ctx.agencyId, ctx.userId],
    );

    const encAccess = accessToken ? encrypt(accessToken) : null;
    const encRefresh = refreshToken ? encrypt(refreshToken) : null;

    if (existing?.id) {
      await db.run(
        `
        UPDATE email_accounts
        SET
          provider = ?,
          email = ?,
          access_token = ?,
          refresh_token = ?,
          expiry_date = ?,
          scope = ?,
          token_type = ?,
          updated_at = ?
        WHERE id = ?
        `,
        [
          "google",
          email,
          encAccess,
          encRefresh,
          expiryDate,
          scope,
          tokenType,
          now,
          existing.id,
        ],
      );
    } else {
      await db.run(
        `
        INSERT INTO email_accounts (
          id, agency_id, user_id, provider,
          email, access_token, refresh_token, expiry_date,
          scope, token_type, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
          `ea_${randomUUID()}`,
          ctx.agencyId,
          ctx.userId,
          "google",
          email,
          encAccess,
          encRefresh,
          expiryDate,
          scope,
          tokenType,
          now,
          now,
        ],
      );
    }

    // Clear state cookie
    const res = NextResponse.redirect(new URL(`/app/email?connected=1`, req.url));
    res.cookies.set("email_oauth_state", "", {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 0,
    });

    return res;
  } catch (err: any) {
    const msg = safeString(err?.code ?? err?.message ?? err);
    // Keep this redirect-based so UI stays simple
    return NextResponse.redirect(new URL(`/app/email?connected=0&error=${encodeURIComponent(msg || "callback_failed")}`, req.url));
  }
}