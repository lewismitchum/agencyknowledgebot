import { google } from "googleapis";
import { getDb } from "@/lib/db";
import { decrypt, encrypt } from "@/lib/crypto";

type AccountRow = {
  id: string;
  email: string | null;
  access_token: string | null;
  refresh_token: string | null;
  expiry_date: number | null;
  provider: string | null;
};

function nowMs() {
  return Date.now();
}

function getEnv(name: string) {
  return String(process.env[name] ?? "").trim();
}

function toIntOrNull(v: any): number | null {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.trunc(n);
}

function safeString(v: any) {
  return String(v ?? "").trim();
}

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

async function dbAll(db: any, sql: string, args: any[] = []) {
  try {
    return await db.all(sql, ...args);
  } catch (err: any) {
    const msg = String(err?.message || "");
    if (msg.includes("Number of arguments mismatch") || msg.includes("expected") || msg.includes("mismatch")) {
      return await db.all(sql, args);
    }
    throw err;
  }
}

async function dbRun(db: any, sql: string, args: any[] = []) {
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

async function ensureEmailAccountsSchema(db: any) {
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
  `);

  const cols = await dbAll(db, `PRAGMA table_info(email_accounts)`);
  const have = new Set((cols || []).map((c: any) => String(c?.name || "").trim()));

  if (!have.has("provider")) {
    await db.exec(`ALTER TABLE email_accounts ADD COLUMN provider TEXT`).catch(() => {});
  }
  if (!have.has("email")) {
    await db.exec(`ALTER TABLE email_accounts ADD COLUMN email TEXT`).catch(() => {});
  }
  if (!have.has("access_token")) {
    await db.exec(`ALTER TABLE email_accounts ADD COLUMN access_token TEXT`).catch(() => {});
  }
  if (!have.has("refresh_token")) {
    await db.exec(`ALTER TABLE email_accounts ADD COLUMN refresh_token TEXT`).catch(() => {});
  }
  if (!have.has("expiry_date")) {
    await db.exec(`ALTER TABLE email_accounts ADD COLUMN expiry_date INTEGER`).catch(() => {});
  }
  if (!have.has("scope")) {
    await db.exec(`ALTER TABLE email_accounts ADD COLUMN scope TEXT`).catch(() => {});
  }
  if (!have.has("token_type")) {
    await db.exec(`ALTER TABLE email_accounts ADD COLUMN token_type TEXT`).catch(() => {});
  }
  if (!have.has("created_at")) {
    await db.exec(`ALTER TABLE email_accounts ADD COLUMN created_at INTEGER NOT NULL DEFAULT 0`).catch(() => {});
  }
  if (!have.has("updated_at")) {
    await db.exec(`ALTER TABLE email_accounts ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0`).catch(() => {});
  }

  await db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_email_accounts_agency_user_provider
      ON email_accounts(agency_id, user_id, provider);
  `);

  await db.exec(`
    CREATE INDEX IF NOT EXISTS idx_email_accounts_agency_user
      ON email_accounts(agency_id, user_id);
  `);
}

async function refreshAccessToken(args: {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}) {
  const body = new URLSearchParams();
  body.set("client_id", args.clientId);
  body.set("client_secret", args.clientSecret);
  body.set("refresh_token", args.refreshToken);
  body.set("grant_type", "refresh_token");

  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
    cache: "no-store",
  });

  const j = (await r.json().catch(() => null)) as any;

  if (!r.ok || !j) {
    return {
      ok: false as const,
      error: "TOKEN_REFRESH_FAILED",
      details: j ?? null,
      status: r.status,
    };
  }

  const accessToken = safeString(j.access_token);
  if (!accessToken) {
    return {
      ok: false as const,
      error: "TOKEN_REFRESH_FAILED",
      details: j ?? null,
      status: r.status,
    };
  }

  return {
    ok: true as const,
    tokens: {
      access_token: accessToken,
      expires_in: toIntOrNull(j.expires_in) ?? 0,
      scope: typeof j.scope === "string" ? j.scope : null,
      token_type: typeof j.token_type === "string" ? j.token_type : null,
      refresh_token: j.refresh_token ? String(j.refresh_token) : null,
    },
  };
}

export async function getValidGmailClient(args: { agencyId: string; userId: string }) {
  const clientId = getEnv("GOOGLE_CLIENT_ID");
  const clientSecret = getEnv("GOOGLE_CLIENT_SECRET");
  const redirectUri = getEnv("GOOGLE_REDIRECT_URI");

  if (!clientId || !clientSecret || !redirectUri) {
    return {
      ok: false as const,
      error: "MISSING_GOOGLE_OAUTH_ENV",
      missing: {
        GOOGLE_CLIENT_ID: !clientId,
        GOOGLE_CLIENT_SECRET: !clientSecret,
        GOOGLE_REDIRECT_URI: !redirectUri,
      },
    };
  }

  const db = await getDb();
  await ensureEmailAccountsSchema(db);

  const account = (await dbGet(
    db,
    `SELECT id, email, access_token, refresh_token, expiry_date, provider
     FROM email_accounts
     WHERE agency_id = ? AND user_id = ? AND (provider = 'google' OR provider = 'gmail' OR provider IS NULL OR provider = '')
     ORDER BY
       CASE
         WHEN provider = 'google' THEN 0
         WHEN provider = 'gmail' THEN 1
         ELSE 2
       END,
       updated_at DESC,
       created_at DESC
     LIMIT 1`,
    [args.agencyId, args.userId]
  )) as AccountRow | undefined;

  if (!account?.id) {
    return { ok: false as const, error: "NOT_CONNECTED" };
  }

  const accessToken = safeString(decrypt(account.access_token) || "");
  const refreshToken = safeString(decrypt(account.refresh_token) || "");
  const expiryDate = account.expiry_date == null ? null : Number(account.expiry_date);

  if (!accessToken && !refreshToken) {
    return { ok: false as const, error: "MISSING_TOKENS" };
  }

  const needsRefresh =
    !accessToken ||
    (expiryDate != null && Number.isFinite(expiryDate) && expiryDate <= nowMs() + 2 * 60 * 1000);

  let finalAccess = accessToken;
  let finalRefresh = refreshToken;
  let finalExpiry: number | null = expiryDate;

  if (needsRefresh) {
    if (!refreshToken) {
      return { ok: false as const, error: "MISSING_REFRESH_TOKEN" };
    }

    const rr = await refreshAccessToken({
      clientId,
      clientSecret,
      refreshToken,
    });

    if (!rr.ok) {
      return {
        ok: false as const,
        error: rr.error,
        details: rr.details,
        status: rr.status,
      };
    }

    finalAccess = safeString(rr.tokens.access_token || "");
    finalExpiry = nowMs() + Math.max(0, Number(rr.tokens.expires_in || 0)) * 1000;

    if (rr.tokens.refresh_token) {
      finalRefresh = safeString(rr.tokens.refresh_token);
    }

    await dbRun(
      db,
      `UPDATE email_accounts
       SET access_token = ?, refresh_token = ?, expiry_date = ?, updated_at = ?, provider = COALESCE(NULLIF(provider, ''), 'google')
       WHERE id = ?`,
      [
        encrypt(finalAccess || ""),
        encrypt(finalRefresh || ""),
        finalExpiry,
        nowMs(),
        account.id,
      ]
    );
  }

  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
  oauth2Client.setCredentials({
    access_token: finalAccess || undefined,
    refresh_token: finalRefresh || undefined,
    expiry_date: finalExpiry || undefined,
  });

  const gmail = google.gmail({ version: "v1", auth: oauth2Client });

  let resolvedEmail = safeString(account.email || "");

  if (!resolvedEmail) {
    try {
      const profile = await gmail.users.getProfile({ userId: "me" });
      resolvedEmail = safeString(profile?.data?.emailAddress || "");

      if (resolvedEmail) {
        await dbRun(
          db,
          `UPDATE email_accounts
           SET email = ?, updated_at = ?, provider = COALESCE(NULLIF(provider, ''), 'google')
           WHERE id = ?`,
          [resolvedEmail, nowMs(), account.id]
        );
      }
    } catch {
      // keep going; send can still work without cached email
    }
  }

  return {
    ok: true as const,
    gmail,
    email: resolvedEmail || null,
  };
}