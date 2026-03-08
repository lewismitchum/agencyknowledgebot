// app/api/agency/invites/accept/route.ts
import { randomUUID } from "crypto";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { getDb, type Db } from "@/lib/db";
import { ensureSchema } from "@/lib/schema";
import { nowIso, hashToken } from "@/lib/tokens";
import { setSessionCookie } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function ensureInviteTables(db: Db) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS agency_invites (
      id TEXT PRIMARY KEY,
      agency_id TEXT NOT NULL,
      email TEXT NOT NULL,
      token_hash TEXT NOT NULL,
      created_at TEXT,
      expires_at TEXT,
      accepted_at TEXT,
      revoked_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_agency_invites_agency ON agency_invites(agency_id);
    CREATE INDEX IF NOT EXISTS idx_agency_invites_email ON agency_invites(email);
    CREATE INDEX IF NOT EXISTS idx_agency_invites_token_hash ON agency_invites(token_hash);
  `);

  const cols = (await db.all(`PRAGMA table_info(agency_invites)`)) as Array<{ name?: string }>;
  const have = new Set((cols || []).map((c) => String(c?.name || "")));

  if (!have.has("accepted_at")) await db.run(`ALTER TABLE agency_invites ADD COLUMN accepted_at TEXT`).catch(() => {});
  if (!have.has("revoked_at")) await db.run(`ALTER TABLE agency_invites ADD COLUMN revoked_at TEXT`).catch(() => {});
  if (!have.has("expires_at")) await db.run(`ALTER TABLE agency_invites ADD COLUMN expires_at TEXT`).catch(() => {});
  if (!have.has("created_at")) await db.run(`ALTER TABLE agency_invites ADD COLUMN created_at TEXT`).catch(() => {});
}

async function ensureUserColumns(db: Db) {
  await db.run("ALTER TABLE users ADD COLUMN role TEXT").catch(() => {});
  await db.run("ALTER TABLE users ADD COLUMN status TEXT").catch(() => {});
  await db.run("ALTER TABLE users ADD COLUMN created_at TEXT").catch(() => {});
  await db.run("ALTER TABLE users ADD COLUMN updated_at TEXT").catch(() => {});
  await db.run("ALTER TABLE users ADD COLUMN email_verified INTEGER").catch(() => {});
  await db.run("ALTER TABLE users ADD COLUMN password_hash TEXT").catch(() => {});
  await db.run("ALTER TABLE users ADD COLUMN has_completed_onboarding INTEGER").catch(() => {});
}

function isEmail(s: string) {
  const v = String(s ?? "").trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

function bad(error: string, status = 400) {
  return NextResponse.json({ ok: false, error }, { status });
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const token = String(url.searchParams.get("token") ?? "").trim();

  if (!token) {
    return bad("MISSING_TOKEN", 400);
  }

  return NextResponse.json({
    ok: true,
    redirectTo: `/accept-invite?token=${encodeURIComponent(token)}`,
  });
}

export async function POST(req: NextRequest) {
  try {
    const db: Db = await getDb();
    await ensureSchema(db);
    await ensureInviteTables(db);
    await ensureUserColumns(db);

    const body = (await req.json().catch(() => ({}))) as any;
    const token = String(body?.token ?? "").trim();
    const password = String(body?.password ?? "").trim();

    if (!token) return bad("MISSING_TOKEN", 400);
    if (!password) return bad("MISSING_PASSWORD", 400);
    if (password.length < 8) return bad("PASSWORD_TOO_SHORT", 400);

    const token_hash = hashToken(token);

    const invite = (await db.get(
      `SELECT id, agency_id, email, expires_at, accepted_at, revoked_at
       FROM agency_invites
       WHERE token_hash = ?
       LIMIT 1`,
      token_hash
    )) as
      | {
          id: string;
          agency_id: string;
          email: string;
          expires_at: string | null;
          accepted_at: string | null;
          revoked_at: string | null;
        }
      | undefined;

    if (!invite?.id) return bad("INVALID_OR_USED_INVITE", 404);
    if (invite.revoked_at) return bad("INVITE_REVOKED", 410);

    const exp = invite.expires_at ? Date.parse(invite.expires_at) : NaN;
    if (invite.expires_at && Number.isFinite(exp) && Date.now() > exp) {
      return bad("INVITE_EXPIRED", 410);
    }

    const email = String(invite.email ?? "").trim().toLowerCase();
    if (!isEmail(email)) return bad("INVITE_EMAIL_INVALID", 400);

    const password_hash = await bcrypt.hash(password, 10);
    const t = nowIso();

    const existingUser = (await db.get(
      `SELECT id, status, role
       FROM users
       WHERE agency_id = ? AND lower(email) = lower(?)
       LIMIT 1`,
      invite.agency_id,
      email
    )) as { id: string; status: string | null; role: string | null } | undefined;

    let userId = existingUser?.id || "";

    if (!userId) {
      userId = randomUUID();

      await db.run(
        `INSERT INTO users
         (id, agency_id, email, email_verified, role, status, has_completed_onboarding, created_at, updated_at, password_hash)
         VALUES (?, ?, ?, 1, 'member', 'active', 0, ?, ?, ?)`,
        userId,
        invite.agency_id,
        email,
        t,
        t,
        password_hash
      );
    } else {
      const status = String(existingUser?.status ?? "").toLowerCase();
      if (status === "blocked") return bad("ACCOUNT_BLOCKED", 403);

      await db.run(
        `UPDATE users
         SET status = 'active',
             role = COALESCE(NULLIF(role,''), 'member'),
             email_verified = 1,
             password_hash = ?,
             updated_at = ?
         WHERE id = ? AND agency_id = ?`,
        password_hash,
        t,
        userId,
        invite.agency_id
      );
    }

    await db.run(
      `UPDATE agency_invites
       SET accepted_at = COALESCE(accepted_at, ?)
       WHERE id = ?`,
      t,
      invite.id
    );

    const agency = (await db.get(
      `SELECT email FROM agencies WHERE id = ? LIMIT 1`,
      invite.agency_id
    )) as { email: string | null } | undefined;

    const agencyEmail = String(agency?.email ?? "").trim().toLowerCase();

    const res = NextResponse.json({
      ok: true,
      redirectTo: "/app/chat",
    });

    setSessionCookie(res, {
      agencyId: invite.agency_id,
      agencyEmail: agencyEmail || email,
      userId,
      userEmail: email,
    });

    return res;
  } catch (err: any) {
    console.error("ACCEPT_INVITE_ERROR", err);
    return NextResponse.json(
      { ok: false, error: "INTERNAL_ERROR", message: String(err?.message ?? err) },
      { status: 500 }
    );
  }
}