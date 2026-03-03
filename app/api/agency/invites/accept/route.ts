// app/api/agency/invites/accept/route.ts
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
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

    CREATE INDEX IF NOT EXISTS idx_agency_invites_agency
      ON agency_invites(agency_id);

    CREATE INDEX IF NOT EXISTS idx_agency_invites_email
      ON agency_invites(email);

    CREATE INDEX IF NOT EXISTS idx_agency_invites_token_hash
      ON agency_invites(token_hash);
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

function parseIso(iso: string | null) {
  if (!iso) return NaN;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : NaN;
}

async function getInviteByTokenHash(db: Db, token_hash: string) {
  return (await db.get(
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
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const token = String(url.searchParams.get("token") ?? "").trim();
  if (!token) return NextResponse.json({ ok: false, error: "MISSING_TOKEN" }, { status: 400 });

  try {
    const db: Db = await getDb();
    await ensureSchema(db);
    await ensureInviteTables(db);
    await ensureUserColumns(db);

    const token_hash = hashToken(token);
    const invite = await getInviteByTokenHash(db, token_hash);

    if (!invite?.id) return NextResponse.json({ ok: false, error: "INVALID_OR_USED_INVITE" }, { status: 404 });
    if (invite.revoked_at) return NextResponse.json({ ok: false, error: "INVITE_REVOKED" }, { status: 410 });

    const exp = parseIso(invite.expires_at);
    if (invite.expires_at && Number.isFinite(exp) && Date.now() > exp) {
      return NextResponse.json({ ok: false, error: "INVITE_EXPIRED" }, { status: 410 });
    }

    const email = String(invite.email ?? "").trim().toLowerCase();
    if (!isEmail(email)) return NextResponse.json({ ok: false, error: "INVITE_EMAIL_INVALID" }, { status: 400 });

    // We do NOT auto-create the session here (no password yet).
    return NextResponse.json({
      ok: true,
      email,
      agency_id: invite.agency_id,
      redirectTo: `/set-password?token=${encodeURIComponent(token)}`,
    });
  } catch (err: any) {
    console.error("ACCEPT_INVITE_GET_ERROR", err);
    return NextResponse.json(
      { ok: false, error: "INTERNAL_ERROR", message: String(err?.message ?? err) },
      { status: 500 }
    );
  }
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

    if (!token) return NextResponse.json({ ok: false, error: "MISSING_TOKEN" }, { status: 400 });
    if (!password) return NextResponse.json({ ok: false, error: "MISSING_PASSWORD" }, { status: 400 });
    if (password.length < 8) return NextResponse.json({ ok: false, error: "PASSWORD_TOO_SHORT" }, { status: 400 });

    const token_hash = hashToken(token);
    const invite = await getInviteByTokenHash(db, token_hash);

    if (!invite?.id) return NextResponse.json({ ok: false, error: "INVALID_OR_USED_INVITE" }, { status: 404 });
    if (invite.revoked_at) return NextResponse.json({ ok: false, error: "INVITE_REVOKED" }, { status: 410 });

    const exp = parseIso(invite.expires_at);
    if (invite.expires_at && Number.isFinite(exp) && Date.now() > exp) {
      return NextResponse.json({ ok: false, error: "INVITE_EXPIRED" }, { status: 410 });
    }

    const email = String(invite.email ?? "").trim().toLowerCase();
    if (!isEmail(email)) return NextResponse.json({ ok: false, error: "INVITE_EMAIL_INVALID" }, { status: 400 });

    const password_hash = await bcrypt.hash(password, 10);

    // Create user if missing; invites are PRE-APPROVED => status active.
    const existingUser = (await db.get(
      `SELECT id, status
       FROM users
       WHERE agency_id = ? AND lower(email) = lower(?)
       LIMIT 1`,
      invite.agency_id,
      email
    )) as { id: string; status: string | null } | undefined;

    let userId = existingUser?.id || "";
    const existingStatus = existingUser?.status ?? "";

    if (!userId) {
      userId = randomUUID();
      await db.run(
        `INSERT INTO users
         (id, agency_id, email, email_verified, role, status, has_completed_onboarding, created_at, updated_at, password_hash)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        userId,
        invite.agency_id,
        email,
        1,
        "member",
        "active",
        0,
        nowIso(),
        nowIso(),
        password_hash
      );
    } else {
      // Do not override blocked users
      const st = String(existingStatus).toLowerCase();
      if (st === "blocked") {
        return NextResponse.json({ ok: false, error: "ACCOUNT_BLOCKED" }, { status: 403 });
      }

      await db.run(
        `UPDATE users
         SET status = 'active',
             email_verified = 1,
             password_hash = ?,
             updated_at = ?
         WHERE id = ? AND agency_id = ?`,
        password_hash,
        nowIso(),
        userId,
        invite.agency_id
      );
    }

    // Mark invite accepted (idempotent-ish)
    await db.run(
      `UPDATE agency_invites
       SET accepted_at = COALESCE(accepted_at, ?)
       WHERE id = ?`,
      nowIso(),
      invite.id
    );

    const agency = (await db.get(`SELECT email FROM agencies WHERE id = ? LIMIT 1`, invite.agency_id)) as
      | { email?: string | null }
      | undefined;

    const agencyEmail = String(agency?.email ?? "").trim().toLowerCase();

    const res = NextResponse.json({
      ok: true,
      redirectTo: "/app/chat",
      user: { id: userId, email, role: "member", status: "active" },
    });

    setSessionCookie(res, {
      agencyId: invite.agency_id,
      agencyEmail,
      userId,
      userEmail: email,
    });

    return res;
  } catch (err: any) {
    console.error("ACCEPT_INVITE_POST_ERROR", err);
    return NextResponse.json(
      { ok: false, error: "INTERNAL_ERROR", message: String(err?.message ?? err) },
      { status: 500 }
    );
  }
}