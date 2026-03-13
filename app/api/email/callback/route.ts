// app/api/email/callback/route.ts
import { NextRequest, NextResponse } from "next/server";
import { google } from "googleapis";
import crypto from "crypto";
import { getDb, type Db } from "@/lib/db";
import { requireActiveMember } from "@/lib/authz";
import { encrypt } from "@/lib/crypto";
import { ensureSchema } from "@/lib/schema";
import { getAgencyPlan } from "@/lib/enforcement";
import { normalizePlan, requireFeature } from "@/lib/plans";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function getBaseUrl(req: NextRequest) {
  const envBase =
    String(process.env.NEXT_PUBLIC_BASE_URL || "").trim() ||
    String(process.env.NEXTAUTH_URL || "").trim();

  if (envBase) return envBase;

  const proto = req.headers.get("x-forwarded-proto") || "http";
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host") || "localhost:3000";
  return `${proto}://${host}`;
}

function safeUrl(req: NextRequest, path: string) {
  try {
    return new URL(path, getBaseUrl(req)).toString();
  } catch {
    return path;
  }
}

function toIntOrNull(v: any): number | null {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.trunc(n);
}

async function ensureEmailAuthColumns(db: Db) {
  await db.run(`ALTER TABLE users ADD COLUMN gmail_connected INTEGER`).catch(() => {});
  await db.run(`ALTER TABLE users ADD COLUMN gmail_connected_at TEXT`).catch(() => {});
}

async function ensureOnboardingColumns(db: Db) {
  const columns = (await db.all(`PRAGMA table_info(users)`)) as Array<{ name?: string }>;
  const hasConnectedGmail = columns.some((c) => c?.name === "connected_gmail");

  if (!hasConnectedGmail) {
    await db.run(`ALTER TABLE users ADD COLUMN connected_gmail INTEGER NOT NULL DEFAULT 0`);
  }
}

async function ensureEmailAccountsTable(db: Db) {
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

    CREATE INDEX IF NOT EXISTS idx_email_accounts_agency
      ON email_accounts(agency_id);

    CREATE INDEX IF NOT EXISTS idx_email_accounts_user
      ON email_accounts(user_id);
  `);
}

export async function GET(req: NextRequest) {
  try {
    const session = await requireActiveMember(req);

    const db: Db = await getDb();
    await ensureSchema(db);
    await ensureEmailAuthColumns(db);
    await ensureOnboardingColumns(db);
    await ensureEmailAccountsTable(db);

    const rawPlan = await getAgencyPlan(db, session.agencyId, session.plan);
    const planKey = normalizePlan(rawPlan);
    const gate = requireFeature(planKey, "email");
    if (!gate.ok) return NextResponse.redirect(safeUrl(req, "/app/billing"));

    const url = new URL(req.url);
    const code = String(url.searchParams.get("code") || "").trim();
    const error = String(url.searchParams.get("error") || "").trim();
    const state = String(url.searchParams.get("state") || "").trim();

    if (error) {
      return NextResponse.redirect(
        safeUrl(req, `/app/email?connected=0&error=${encodeURIComponent(error)}`)
      );
    }

    if (!code) {
      return NextResponse.redirect(safeUrl(req, "/app/email?connected=0&error=missing_code"));
    }

    const cookieState = String(req.cookies.get("email_oauth_state")?.value || "").trim();
    if (!cookieState || !state || cookieState !== state) {
      return NextResponse.redirect(safeUrl(req, "/app/email?connected=0&error=state_mismatch"));
    }

    const clientId = String(process.env.GOOGLE_CLIENT_ID || "").trim();
    const clientSecret = String(process.env.GOOGLE_CLIENT_SECRET || "").trim();
    const redirectUri = String(process.env.GOOGLE_REDIRECT_URI || "").trim();

    if (!clientId || !clientSecret || !redirectUri) {
      return NextResponse.redirect(safeUrl(req, "/app/email?connected=0&error=oauth_env_missing"));
    }

    const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);

    const tokenRes = await oauth2Client.getToken(code);
    const tokens = tokenRes.tokens || {};

    const accessToken = typeof tokens.access_token === "string" ? tokens.access_token : "";
    const refreshToken = typeof tokens.refresh_token === "string" ? tokens.refresh_token : "";
    const expiryDate = toIntOrNull(tokens.expiry_date);

    if (!accessToken && !refreshToken) {
      return NextResponse.redirect(safeUrl(req, "/app/email?connected=0&error=missing_tokens"));
    }

    oauth2Client.setCredentials({
      access_token: accessToken || undefined,
      refresh_token: refreshToken || undefined,
      expiry_date: expiryDate || undefined,
    });

    let mailboxEmail: string | null = null;
    try {
      const oauth2 = google.oauth2({ version: "v2", auth: oauth2Client });
      const me = await oauth2.userinfo.get();
      mailboxEmail = me?.data?.email ? String(me.data.email) : null;
    } catch {
      mailboxEmail = null;
    }

    const existing = (await db.get(
      `SELECT id, refresh_token
       FROM email_accounts
       WHERE agency_id = ? AND user_id = ?
       LIMIT 1`,
      session.agencyId,
      session.userId
    )) as { id?: string; refresh_token?: string } | undefined;

    const accountId = existing?.id ? String(existing.id) : `ea_${crypto.randomUUID()}`;

    const encAccess = accessToken ? encrypt(accessToken) : "";
    const encRefresh = refreshToken ? encrypt(refreshToken) : "";
    const finalRefresh = encRefresh || (existing?.refresh_token ? String(existing.refresh_token) : "");

    const now = Date.now();

    if (existing?.id) {
      await db.run(
        `UPDATE email_accounts
         SET provider = ?,
             email = ?,
             access_token = ?,
             refresh_token = ?,
             expiry_date = ?,
             scope = ?,
             token_type = ?,
             updated_at = ?
         WHERE agency_id = ? AND user_id = ?`,
        "gmail",
        mailboxEmail,
        encAccess || "",
        finalRefresh || "",
        expiryDate,
        typeof tokens.scope === "string" ? tokens.scope : null,
        typeof tokens.token_type === "string" ? tokens.token_type : null,
        now,
        session.agencyId,
        session.userId
      );
    } else {
      await db.run(
        `INSERT INTO email_accounts
          (id, agency_id, user_id, provider, email, access_token, refresh_token, expiry_date, scope, token_type, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        accountId,
        session.agencyId,
        session.userId,
        "gmail",
        mailboxEmail,
        encAccess || "",
        finalRefresh || "",
        expiryDate,
        typeof tokens.scope === "string" ? tokens.scope : null,
        typeof tokens.token_type === "string" ? tokens.token_type : null,
        now,
        now
      );
    }

    await db.run(
      `UPDATE users
       SET gmail_connected = 1,
           gmail_connected_at = ?,
           connected_gmail = 1
       WHERE id = ? AND agency_id = ?`,
      new Date().toISOString(),
      session.userId,
      session.agencyId
    );

    const res = NextResponse.redirect(safeUrl(req, "/app/email?connected=1"));
    res.cookies.set("email_oauth_state", "", {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 0,
    });
    return res;
  } catch (err: any) {
    console.error("Email OAuth callback error:", err);
    const msg = String(err?.message || "oauth_error");
    return NextResponse.redirect(
      safeUrl(req, `/app/email?connected=0&error=${encodeURIComponent(msg)}`)
    );
  }
}