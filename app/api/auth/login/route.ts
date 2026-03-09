// app/api/auth/login/route.ts
import { randomUUID } from "crypto";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { getDb, type Db } from "@/lib/db";
import { setSessionCookie } from "@/lib/session";
import { ensureSchema } from "@/lib/schema";
import { enforceRateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function readBody(req: NextRequest): Promise<{
  email?: string;
  password?: string;
  agency?: string;
  next?: string;
  turnstile_token?: string;
}> {
  const ct = req.headers.get("content-type") || "";

  if (ct.includes("application/json")) {
    const j = await req.json().catch(() => ({}));
    return {
      email: j?.email,
      password: j?.password,
      agency: j?.agency,
      next: j?.next,
      turnstile_token: j?.turnstile_token,
    };
  }

  const text = await req.text().catch(() => "");
  const params = new URLSearchParams(text);

  return {
    email: params.get("email") || undefined,
    password: params.get("password") || undefined,
    agency: params.get("agency") || undefined,
    next: params.get("next") || undefined,
    turnstile_token: params.get("turnstile_token") || undefined,
  };
}

function nowIso() {
  return new Date().toISOString();
}

function normNext(s: any) {
  const v = String(s ?? "").trim();
  if (!v) return "/app";
  if (!v.startsWith("/")) return "/app";
  if (v.startsWith("//")) return "/app";
  return v;
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

async function verifyTurnstile(token: string, ip: string | null) {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) return { ok: false as const, error: "TURNSTILE_SECRET_MISSING" };
  if (!token) return { ok: false as const, error: "TURNSTILE_REQUIRED" };

  const form = new URLSearchParams();
  form.set("secret", secret);
  form.set("response", token);
  if (ip) form.set("remoteip", ip);

  const r = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form.toString(),
  });

  const j = (await r.json().catch(() => null)) as any;
  if (j && j.success) return { ok: true as const };

  return { ok: false as const, error: "TURNSTILE_FAILED", details: j ?? null };
}

function normRole(r: any): "owner" | "admin" | "member" {
  const v = String(r ?? "").toLowerCase();
  if (v === "owner") return "owner";
  if (v === "admin") return "admin";
  return "member";
}

function normStatus(s: any): "active" | "pending" | "blocked" {
  const v = String(s ?? "").toLowerCase();
  if (v === "active") return "active";
  if (v === "blocked") return "blocked";
  return "pending";
}

async function getOrMigrateIdentityByEmail(db: Db, email: string, password: string) {
  await ensureIdentityTables(db);

  const existing = (await db.get(
    `SELECT id, email, password_hash, email_verified
     FROM identities
     WHERE lower(email) = lower(?)
     LIMIT 1`,
    email
  )) as { id: string; email: string; password_hash: string | null; email_verified: number | null } | undefined;

  if (existing?.id) {
    const identityHash = String(existing.password_hash ?? "").trim();

    if (identityHash) {
      const identityOk = await bcrypt.compare(password, identityHash).catch(() => false);
      if (identityOk) {
        return { mode: "identity" as const, identity: existing };
      }
    }

    const legacy = (await db.get(
      `SELECT password_hash
       FROM users
       WHERE lower(email) = lower(?)
         AND password_hash IS NOT NULL
         AND trim(password_hash) != ''
       LIMIT 1`,
      email
    )) as { password_hash: string } | undefined;

    const legacyHash = String(legacy?.password_hash ?? "").trim();

    if (legacyHash) {
      const legacyOk = await bcrypt.compare(password, legacyHash).catch(() => false);

      if (legacyOk) {
        await db.run(
          `UPDATE identities
           SET password_hash = ?, updated_at = ?
           WHERE id = ?`,
          legacyHash,
          nowIso(),
          existing.id
        );

        const repaired = (await db.get(
          `SELECT id, email, password_hash, email_verified
           FROM identities
           WHERE id = ?
           LIMIT 1`,
          existing.id
        )) as
          | {
              id: string;
              email: string;
              password_hash: string | null;
              email_verified: number | null;
            }
          | undefined;

        return { mode: "identity_repaired" as const, identity: repaired ?? existing };
      }
    }

    return { mode: "identity" as const, identity: existing };
  }

  const legacy = (await db.get(
    `SELECT password_hash
     FROM users
     WHERE lower(email) = lower(?)
       AND password_hash IS NOT NULL
       AND trim(password_hash) != ''
     LIMIT 1`,
    email
  )) as { password_hash: string } | undefined;

  const legacyHash = String(legacy?.password_hash ?? "").trim();
  if (!legacyHash) return { mode: "none" as const, identity: null };

  const ok = await bcrypt.compare(password, legacyHash);
  if (!ok) return { mode: "none" as const, identity: null };

  const id = randomUUID();
  const t = nowIso();

  await db.run(
    `INSERT INTO identities (id, email, password_hash, email_verified, created_at, updated_at)
     VALUES (?, ?, ?, 1, ?, ?)`,
    id,
    email.trim().toLowerCase(),
    legacyHash,
    t,
    t
  );

  await db.run(
    `UPDATE users
     SET identity_id = COALESCE(identity_id, ?),
         updated_at = COALESCE(updated_at, ?)
     WHERE lower(email) = lower(?)`,
    id,
    t,
    email
  );

  const created = (await db.get(
    `SELECT id, email, password_hash, email_verified
     FROM identities
     WHERE id = ?
     LIMIT 1`,
    id
  )) as { id: string; email: string; password_hash: string | null; email_verified: number | null } | undefined;

  return { mode: "migrated" as const, identity: created ?? null };
}

export async function POST(req: NextRequest) {
  try {
    const { email, password, agency, next, turnstile_token } = await readBody(req);

    if (!email?.trim() || !password?.trim() || !agency?.trim()) {
      return NextResponse.json({ error: "Missing fields" }, { status: 400 });
    }

    const ip =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      req.headers.get("x-real-ip") ||
      "unknown";

    try {
      await enforceRateLimit({
        userId: `ip:${ip}`,
        agencyId: "public",
        key: "login",
        perMinute: 10,
        perHour: 200,
      });
    } catch {
      return NextResponse.json({ error: "Too many attempts. Try again shortly." }, { status: 429 });
    }

    const ts = await verifyTurnstile(String(turnstile_token || ""), ip === "unknown" ? null : ip);
    if (!ts.ok) {
      return NextResponse.json({ error: ts.error }, { status: 400 });
    }

    const db: Db = await getDb();
    await ensureSchema(db).catch((e) => console.error("SCHEMA_ENSURE_FAILED", e));
    await ensureUserColumns(db);
    await ensureIdentityTables(db);

    const normalizedEmail = email.trim().toLowerCase();
    const agencyNeedle = agency.trim().toLowerCase();
    const nextPath = normNext(next);

    const agencyRow = (await db.get(
      `SELECT id, email, name
       FROM agencies
       WHERE lower(name) = lower(?)
       LIMIT 1`,
      agencyNeedle
    )) as { id: string; email: string; name: string | null } | undefined;

    if (!agencyRow?.id) {
      return NextResponse.json({ error: "Agency not found" }, { status: 404 });
    }

    const identRes = await getOrMigrateIdentityByEmail(db, normalizedEmail, String(password));
    const identity = identRes.identity;

    if (!identity?.id) {
      return NextResponse.json({ error: "Invalid email or password" }, { status: 401 });
    }

    const identityHash = String(identity.password_hash ?? "").trim();
    if (!identityHash) {
      return NextResponse.json(
        {
          error: "NO_PASSWORD_SET",
          message: "You need to set a password before logging in.",
          redirectTo: `/set-password?email=${encodeURIComponent(normalizedEmail)}&agency=${encodeURIComponent(
            agencyRow.name || agency
          )}`,
        },
        { status: 403 }
      );
    }

    const ok = await bcrypt.compare(String(password), identityHash);
    if (!ok) {
      return NextResponse.json({ error: "Invalid email or password" }, { status: 401 });
    }

    const user = (await db.get(
      `SELECT id, email, role, status, has_completed_onboarding
       FROM users
       WHERE agency_id = ? AND lower(email) = lower(?)
       LIMIT 1`,
      agencyRow.id,
      normalizedEmail
    )) as
      | {
          id: string;
          email: string;
          role: string | null;
          status: string | null;
          has_completed_onboarding: number | null;
        }
      | undefined;

    if (!user?.id) {
      return NextResponse.json({ error: "No access to that agency" }, { status: 403 });
    }

    await db
      .run(
        `UPDATE users
         SET identity_id = COALESCE(identity_id, ?),
             updated_at = COALESCE(updated_at, ?)
         WHERE id = ?`,
        identity.id,
        nowIso(),
        user.id
      )
      .catch(() => {});

    const role = normRole(user.role);
    const status = normStatus(user.status);

    if (status !== "active") {
      return NextResponse.json(
        {
          ok: false,
          error: status === "blocked" ? "ACCOUNT_BLOCKED" : "PENDING_APPROVAL",
          redirectTo: "/pending-approval",
          user: { id: user.id, email: user.email, role, status },
        },
        { status: 403 }
      );
    }

    const res = NextResponse.json({
      ok: true,
      redirectTo: nextPath || "/app",
      user: { id: user.id, email: user.email, role, status },
      identity: { id: identity.id, email: normalizedEmail },
      agency: { id: agencyRow.id, name: agencyRow.name ?? agency },
    });

    setSessionCookie(res, {
      agencyId: agencyRow.id,
      agencyEmail: String(agencyRow.email || "").trim(),
      userId: user.id,
      userEmail: normalizedEmail,
      identityId: identity.id,
      identityEmail: normalizedEmail,
    });

    return res;
  } catch (err: any) {
    console.error("LOGIN_ERROR", err);
    return NextResponse.json(
      { error: "Server error", message: String(err?.message || "Unknown error") },
      { status: 500 }
    );
  }
}