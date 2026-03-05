// app/api/auth/set-password/route.ts
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { getDb, type Db } from "@/lib/db";
import { ensureSchema } from "@/lib/schema";
import { hashToken, nowIso } from "@/lib/tokens";
import { setSessionCookie } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function readBody(req: NextRequest): Promise<{ token?: string; password?: string; turnstile_token?: string }> {
  const ct = req.headers.get("content-type") || "";
  if (ct.includes("application/json")) {
    const j = await req.json().catch(() => ({}));
    return { token: j?.token, password: j?.password, turnstile_token: j?.turnstile_token };
  }
  const text = await req.text().catch(() => "");
  const params = new URLSearchParams(text);
  return {
    token: params.get("token") || undefined,
    password: params.get("password") || undefined,
    turnstile_token: params.get("turnstile_token") || undefined,
  };
}

async function verifyTurnstile(token: string, ip: string | null) {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) return { ok: false as const, error: "TURNSTILE_SECRET_MISSING" };
  if (!token) return { ok: false as const, error: "TURNSTILE_REQUIRED" };

  const form = new URLSearchParams();
  form.set("secret", secret);
  form.set("response", token);
  if (ip) form.set("remoteip", ip);

  const r = await fetchJson("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form.toString(),
  });

  const j = (await r.json().catch(() => null)) as any;
  if (j && j.success) return { ok: true as const };
  return { ok: false as const, error: "TURNSTILE_FAILED", details: j ?? null };
}

async function ensureIdentityTables(db: Db) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS identities (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      password_hash TEXT,
      email_verified INTEGER DEFAULT 0,
      created_at TEXT,
      updated_at TEXT
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_identities_email ON identities(lower(email));
  `);
}

async function ensureUserColumns(db: Db) {
  await db.run("ALTER TABLE users ADD COLUMN role TEXT").catch(() => {});
  await db.run("ALTER TABLE users ADD COLUMN status TEXT").catch(() => {});
  await db.run("ALTER TABLE users ADD COLUMN created_at TEXT").catch(() => {});
  await db.run("ALTER TABLE users ADD COLUMN updated_at TEXT").catch(() => {});
  await db.run("ALTER TABLE users ADD COLUMN email_verified INTEGER").catch(() => {});
  await db.run("ALTER TABLE users ADD COLUMN password_hash TEXT").catch(() => {});
  await db.run("ALTER TABLE users ADD COLUMN has_completed_onboarding INTEGER").catch(() => {});
  await db.run("ALTER TABLE users ADD COLUMN identity_id TEXT").catch(() => {});
}

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

function isStrongEnough(pw: string) {
  return String(pw || "").trim().length >= 10;
}

export async function POST(req: NextRequest) {
  try {
    const { token, password, turnstile_token } = await readBody(req);

    const rawToken = String(token || "").trim();
    const rawPw = String(password || "");

    if (!rawToken) return NextResponse.json({ error: "MISSING_TOKEN" }, { status: 400 });
    if (!isStrongEnough(rawPw)) return NextResponse.json({ error: "WEAK_PASSWORD" }, { status: 400 });

    const ip =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      req.headers.get("x-real-ip") ||
      null;

    const ts = await verifyTurnstile(String(turnstile_token || ""), ip);
    if (!ts.ok) return NextResponse.json({ error: ts.error }, { status: 400 });

    const db: Db = await getDb();
    await ensureSchema(db);
    await ensureIdentityTables(db);
    await ensureUserColumns(db);
    await ensureInviteTables(db);

    const token_hash = hashToken(rawToken);

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

    if (!invite?.id) return NextResponse.json({ error: "INVALID_INVITE" }, { status: 404 });
    if (invite.revoked_at) return NextResponse.json({ error: "INVITE_REVOKED" }, { status: 410 });

    const exp = invite.expires_at ? Date.parse(invite.expires_at) : NaN;
    if (invite.expires_at && Number.isFinite(exp) && Date.now() > exp) {
      return NextResponse.json({ error: "INVITE_EXPIRED" }, { status: 410 });
    }

    const email = String(invite.email || "").trim().toLowerCase();
    if (!email) return NextResponse.json({ error: "INVITE_EMAIL_INVALID" }, { status: 400 });

    const agency = (await db.get(`SELECT id, email, name FROM agencies WHERE id = ? LIMIT 1`, invite.agency_id)) as
      | { id: string; email: string; name: string | null }
      | undefined;

    if (!agency?.id) return NextResponse.json({ error: "AGENCY_NOT_FOUND" }, { status: 404 });

    // Create or update identity
    let identity = (await db.get(
      `SELECT id, email FROM identities WHERE lower(email) = lower(?) LIMIT 1`,
      email
    )) as { id: string; email: string } | undefined;

    if (!identity?.id) {
      const identityId = crypto.randomUUID();
      await db.run(
        `INSERT INTO identities (id, email, password_hash, email_verified, created_at, updated_at)
         VALUES (?, ?, NULL, 0, ?, ?)`,
        identityId,
        email,
        nowIso(),
        nowIso()
      );
      identity = { id: identityId, email };
    }

    const pwHash = await bcrypt.hash(rawPw, 10);

    await db.run(
      `UPDATE identities
       SET password_hash = ?,
           email_verified = 1,
           updated_at = ?
       WHERE id = ?`,
      pwHash,
      nowIso(),
      identity.id
    );

    // Ensure membership row exists and is ACTIVE (invited users should not be pending)
    const user = (await db.get(
      `SELECT id, role, status
       FROM users
       WHERE agency_id = ? AND lower(email) = lower(?)
       LIMIT 1`,
      agency.id,
      email
    )) as { id: string; role: string | null; status: string | null } | undefined;

    if (!user?.id) {
      const userId = crypto.randomUUID();
      await db.run(
        `INSERT INTO users
         (id, agency_id, email, email_verified, role, status, has_completed_onboarding, created_at, updated_at, password_hash, identity_id)
         VALUES (?, ?, ?, 1, 'member', 'active', 0, ?, ?, ?, ?)`,
        userId,
        agency.id,
        email,
        nowIso(),
        nowIso(),
        pwHash,
        identity.id
      );

      // Mark invite accepted
      await db.run(`UPDATE agency_invites SET accepted_at = ? WHERE id = ?`, nowIso(), invite.id);

      const res = NextResponse.json({ ok: true, redirectTo: "/app" });
      setSessionCookie(res, {
        agencyId: agency.id,
        agencyEmail: String(agency.email || "").trim().toLowerCase(),
        userId,
        userEmail: email,
        identityId: identity.id,
        identityEmail: email,
      });
      return res;
    }

    // Update existing membership: make active, attach identity, set password_hash for legacy compatibility
    await db.run(
      `UPDATE users
       SET status = 'active',
           email_verified = 1,
           identity_id = COALESCE(identity_id, ?),
           password_hash = COALESCE(NULLIF(password_hash,''), ?),
           updated_at = ?
       WHERE id = ?`,
      identity.id,
      pwHash,
      nowIso(),
      user.id
    );

    // Mark invite accepted
    await db.run(`UPDATE agency_invites SET accepted_at = ? WHERE id = ?`, nowIso(), invite.id);

    const res = NextResponse.json({ ok: true, redirectTo: "/app" });
    setSessionCookie(res, {
      agencyId: agency.id,
      agencyEmail: String(agency.email || "").trim().toLowerCase(),
      userId: user.id,
      userEmail: email,
      identityId: identity.id,
      identityEmail: email,
    });
    return res;
  } catch (err: any) {
    console.error("SET_PASSWORD_ERROR", err);
    return NextResponse.json({ error: "Server error", message: String(err?.message ?? err) }, { status: 500 });
  }
}