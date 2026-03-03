// app/api/accept-invite/route.ts
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
      expires_at TEXT,
      created_at TEXT,
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
  if (!have.has("token_hash")) await db.run(`ALTER TABLE agency_invites ADD COLUMN token_hash TEXT`).catch(() => {});
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
    if (password.length < 8)
      return NextResponse.json({ ok: false, error: "WEAK_PASSWORD" }, { status: 400 });

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

    if (!invite?.id) return NextResponse.json({ ok: false, error: "INVALID_INVITE" }, { status: 404 });
    if (invite.revoked_at) return NextResponse.json({ ok: false, error: "INVITE_REVOKED" }, { status: 410 });

    // expires check (ISO string)
    const exp = invite.expires_at ? Date.parse(invite.expires_at) : NaN;
    if (invite.expires_at && Number.isFinite(exp) && Date.now() > exp) {
      return NextResponse.json({ ok: false, error: "INVITE_EXPIRED" }, { status: 410 });
    }

    const email = String(invite.email ?? "").trim().toLowerCase();
    if (!isEmail(email)) return NextResponse.json({ ok: false, error: "INVITE_EMAIL_INVALID" }, { status: 400 });

    const password_hash = await bcrypt.hash(password, 10);
    const t = nowIso();

    // Find or create user in that agency
    const existingUser = (await db.get(
      `SELECT id, status, role
       FROM users
       WHERE agency_id = ? AND lower(email) = lower(?)
       LIMIT 1`,
      invite.agency_id,
      email
    )) as { id: string; status: string | null; role: string | null } | undefined;

    if (!existingUser?.id) {
      const userId = crypto.randomUUID();
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

      // mark invite accepted
      await db.run(`UPDATE agency_invites SET accepted_at = ? WHERE id = ?`, t, invite.id);

      const res = NextResponse.json({ ok: true, redirectTo: "/app/chat" });
      setSessionCookie(res, {
        agencyId: invite.agency_id,
        agencyEmail: email, // stored but not used for authz decisions (userId+userEmail is what matters)
        userId,
        userEmail: email,
      });
      return res;
    }

    // If blocked, do not override
    const status = String(existingUser.status ?? "").toLowerCase();
    if (status === "blocked") {
      return NextResponse.json({ ok: false, error: "ACCOUNT_BLOCKED" }, { status: 403 });
    }

    // Existing user: activate + set password
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
      existingUser.id,
      invite.agency_id
    );

    // mark invite accepted (idempotent)
    await db.run(`UPDATE agency_invites SET accepted_at = COALESCE(accepted_at, ?) WHERE id = ?`, t, invite.id);

    const res = NextResponse.json({ ok: true, redirectTo: "/app/chat" });
    setSessionCookie(res, {
      agencyId: invite.agency_id,
      agencyEmail: email,
      userId: existingUser.id,
      userEmail: email,
    });
    return res;
  } catch (err: any) {
    console.error("ACCEPT_INVITE_API_ERROR", err);
    return NextResponse.json(
      { ok: false, error: "INTERNAL_ERROR", message: String(err?.message ?? err) },
      { status: 500 }
    );
  }
}