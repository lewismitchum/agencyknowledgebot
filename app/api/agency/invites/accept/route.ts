// app/api/agency/invites/accept/route.ts
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { getDb, type Db } from "@/lib/db";
import { ensureSchema } from "@/lib/schema";
import { nowIso, hashToken } from "@/lib/tokens";
import { sendWelcomeEmailSafe } from "@/lib/email";

export const runtime = "nodejs";

async function ensureInviteTables(db: Db) {
  // Drift-safe: create if missing + add columns if older prototypes exist
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

  const cols = (await db.all(`PRAGMA table_info(agency_invites)`)) as Array<{
    name?: string;
  }>;
  const have = new Set((cols || []).map((c) => String(c?.name || "")));

  if (!have.has("accepted_at"))
    await db
      .run(`ALTER TABLE agency_invites ADD COLUMN accepted_at TEXT`)
      .catch(() => {});
  if (!have.has("revoked_at"))
    await db
      .run(`ALTER TABLE agency_invites ADD COLUMN revoked_at TEXT`)
      .catch(() => {});
  if (!have.has("expires_at"))
    await db
      .run(`ALTER TABLE agency_invites ADD COLUMN expires_at TEXT`)
      .catch(() => {});
  if (!have.has("created_at"))
    await db
      .run(`ALTER TABLE agency_invites ADD COLUMN created_at TEXT`)
      .catch(() => {});
}

async function ensureUserColumns(db: Db) {
  await db.run("ALTER TABLE users ADD COLUMN role TEXT").catch(() => {});
  await db.run("ALTER TABLE users ADD COLUMN status TEXT").catch(() => {});
  await db.run("ALTER TABLE users ADD COLUMN created_at TEXT").catch(() => {});
  await db.run("ALTER TABLE users ADD COLUMN updated_at TEXT").catch(() => {});
  await db
    .run("ALTER TABLE users ADD COLUMN email_verified INTEGER")
    .catch(() => {});
  await db
    .run("ALTER TABLE users ADD COLUMN password_hash TEXT")
    .catch(() => {});
  await db
    .run("ALTER TABLE users ADD COLUMN has_completed_onboarding INTEGER")
    .catch(() => {});
}

function isEmail(s: string) {
  const v = String(s ?? "").trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const token = String(url.searchParams.get("token") ?? "").trim();
  if (!token) {
    return NextResponse.json(
      { ok: false, error: "MISSING_TOKEN" },
      { status: 400 }
    );
  }

  return POST(
    new Request(req.url, {
      method: "POST",
      headers: req.headers,
      body: JSON.stringify({ token }),
    }) as unknown as NextRequest
  );
}

export async function POST(req: NextRequest) {
  try {
    const db: Db = await getDb();
    await ensureSchema(db);
    await ensureInviteTables(db);
    await ensureUserColumns(db);

    const body = (await req.json().catch(() => ({}))) as any;
    const token = String(body?.token ?? "").trim();

    if (!token) {
      return NextResponse.json(
        { ok: false, error: "MISSING_TOKEN" },
        { status: 400 }
      );
    }

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

    if (!invite?.id) {
      return NextResponse.json(
        { ok: false, error: "INVALID_OR_USED_INVITE" },
        { status: 404 }
      );
    }

    if (invite.revoked_at) {
      return NextResponse.json(
        { ok: false, error: "INVITE_REVOKED" },
        { status: 410 }
      );
    }

    // expires check (string ISO)
    const exp = invite.expires_at ? Date.parse(invite.expires_at) : NaN;
    if (invite.expires_at && Number.isFinite(exp) && Date.now() > exp) {
      return NextResponse.json(
        { ok: false, error: "INVITE_EXPIRED" },
        { status: 410 }
      );
    }

    const email = String(invite.email ?? "").trim().toLowerCase();
    if (!isEmail(email)) {
      return NextResponse.json(
        { ok: false, error: "INVITE_EMAIL_INVALID" },
        { status: 400 }
      );
    }

    // If already accepted: do NOT force pending, just send them to signup/login.
    if (invite.accepted_at) {
      return NextResponse.json({
        ok: true,
        alreadyAccepted: true,
        agency_id: invite.agency_id,
        email,
        // They might already have a password/session; if not, they’ll go through login/signup.
        redirectTo: "/login",
      });
    }

    // Create user in that agency if missing; otherwise ensure ACTIVE (invited users skip approval)
    const existingUser = (await db.get(
      `SELECT id, role, status
       FROM users
       WHERE agency_id = ? AND lower(email) = lower(?)
       LIMIT 1`,
      invite.agency_id,
      email
    )) as { id: string; role: string | null; status: string | null } | undefined;

    if (!existingUser?.id) {
      const userId = randomUUID();
      await db.run(
        `INSERT INTO users
         (id, agency_id, email, email_verified, role, status, has_completed_onboarding, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        userId,
        invite.agency_id,
        email,
        0,
        "member",
        "active",
        0,
        nowIso(),
        nowIso()
      );
    } else {
      const status = String(existingUser.status ?? "active").toLowerCase();
      if (status !== "blocked") {
        await db.run(
          `UPDATE users
           SET role = COALESCE(NULLIF(role,''), 'member'),
               status = 'active',
               updated_at = ?
           WHERE id = ? AND agency_id = ?`,
          nowIso(),
          existingUser.id,
          invite.agency_id
        );
      } else {
        // blocked stays blocked
        return NextResponse.json(
          { ok: false, error: "USER_BLOCKED" },
          { status: 403 }
        );
      }
    }

    // Mark invite accepted
    await db.run(
      `UPDATE agency_invites
       SET accepted_at = ?
       WHERE id = ?`,
      nowIso(),
      invite.id
    );

    // Optional: send welcome email (non-blocking)
    const agency = (await db.get(
      `SELECT name FROM agencies WHERE id = ? LIMIT 1`,
      invite.agency_id
    )) as { name?: string | null } | undefined;

    const agencyName = String(agency?.name ?? "").trim();
    if (agencyName) {
      void sendWelcomeEmailSafe({ to: email, agencyName });
    }

    // Invited users should go straight into the app after they authenticate.
    // Your auth flow will decide whether they need /signup or /login.
    return NextResponse.json({
      ok: true,
      agency_id: invite.agency_id,
      email,
      status: "active",
      redirectTo: "/app",
    });
  } catch (err: any) {
    console.error("ACCEPT_INVITE_ERROR", err);
    return NextResponse.json(
      {
        ok: false,
        error: "INTERNAL_ERROR",
        message: String(err?.message ?? err),
      },
      { status: 500 }
    );
  }
}