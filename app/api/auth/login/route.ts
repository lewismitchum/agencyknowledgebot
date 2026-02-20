// app/api/auth/login/route.ts
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { getDb, type Db } from "@/lib/db";
import { setSessionCookie } from "@/lib/session";
import { ensureSchema } from "@/lib/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function readBody(req: NextRequest): Promise<{ email?: string; password?: string; turnstile_token?: string }> {
  const ct = req.headers.get("content-type") || "";
  if (ct.includes("application/json")) {
    const j = await req.json().catch(() => ({}));
    return { email: j?.email, password: j?.password, turnstile_token: j?.turnstile_token };
  }
  const text = await req.text().catch(() => "");
  const params = new URLSearchParams(text);
  return {
    email: params.get("email") || undefined,
    password: params.get("password") || undefined,
    turnstile_token: params.get("turnstile_token") || undefined,
  };
}

function nowIso() {
  return new Date().toISOString();
}

async function ensureUserColumns(db: Db) {
  await db.run("ALTER TABLE users ADD COLUMN role TEXT").catch(() => {});
  await db.run("ALTER TABLE users ADD COLUMN status TEXT").catch(() => {});
  await db.run("ALTER TABLE users ADD COLUMN created_at TEXT").catch(() => {});
  await db.run("ALTER TABLE users ADD COLUMN updated_at TEXT").catch(() => {});
  await db.run("ALTER TABLE users ADD COLUMN email_verified INTEGER").catch(() => {});
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

/**
 * Ensures there is at least one owner for the agency.
 * Rule: if there are no users yet for this agency, the agency email becomes owner+active.
 * Otherwise do nothing.
 */
async function ensureFirstOwner(db: Db, agency: { id: string; email: string }) {
  await ensureUserColumns(db);

  const countRow = (await db.get(
    `SELECT COUNT(*) as c
     FROM users
     WHERE agency_id = ?`,
    agency.id
  )) as { c: number } | undefined;

  const c = Number(countRow?.c ?? 0);
  const normalizedEmail = agency.email.trim().toLowerCase();

  if (c > 0) return;

  const existing = (await db.get(
    `SELECT id
     FROM users
     WHERE agency_id = ? AND lower(email) = ?
     LIMIT 1`,
    agency.id,
    normalizedEmail
  )) as { id: string } | undefined;

  const t = nowIso();

  if (existing?.id) {
    await db.run(
      `UPDATE users
       SET role = 'owner',
           status = 'active',
           email_verified = 1,
           updated_at = ?
       WHERE id = ? AND agency_id = ?`,
      t,
      existing.id,
      agency.id
    );
    return;
  }

  const id = crypto.randomUUID();
  await db.run(
    `INSERT INTO users (id, agency_id, email, email_verified, role, status, created_at, updated_at)
     VALUES (?, ?, ?, 1, 'owner', 'active', ?, ?)`,
    id,
    agency.id,
    normalizedEmail,
    t,
    t
  );
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

export async function POST(req: NextRequest) {
  try {
    const { email, password, turnstile_token } = await readBody(req);

    if (!email?.trim() || !password?.trim()) {
      return NextResponse.json({ error: "Missing fields" }, { status: 400 });
    }

    const ip =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      req.headers.get("x-real-ip") ||
      null;

    const ts = await verifyTurnstile(String(turnstile_token || ""), ip);
    if (!ts.ok) {
      return NextResponse.json({ error: ts.error }, { status: 400 });
    }

    const db: Db = await getDb();
    await ensureSchema(db).catch((e) => console.error("SCHEMA_ENSURE_FAILED", e));

    const normalizedEmail = email.trim().toLowerCase();

    const agency = (await db.get(
      "SELECT id, email, password_hash, email_verified FROM agencies WHERE lower(email) = ? LIMIT 1",
      normalizedEmail
    )) as
      | { id: string; email: string; password_hash: string | null; email_verified: number | null }
      | undefined;

    if (!agency?.id) {
      return NextResponse.json({ error: "Invalid email or password" }, { status: 401 });
    }

    const hash = String(agency.password_hash ?? "").trim();
    if (!hash) {
      return NextResponse.json({ error: "Invalid email or password" }, { status: 401 });
    }

    const ok = await bcrypt.compare(password, hash);
    if (!ok) {
      return NextResponse.json({ error: "Invalid email or password" }, { status: 401 });
    }

    const verified = Number(agency.email_verified ?? 0);
    if (verified === 0) {
      return NextResponse.json({ error: "Please verify your email before logging in." }, { status: 403 });
    }

    await ensureFirstOwner(db, { id: agency.id, email: agency.email });
    await ensureUserColumns(db);

    let user = (await db.get(
      `SELECT id, email, email_verified, role, status
       FROM users
       WHERE agency_id = ? AND lower(email) = ?
       LIMIT 1`,
      agency.id,
      normalizedEmail
    )) as
      | { id: string; email: string; email_verified: number; role: string | null; status: string | null }
      | undefined;

    if (!user?.id) {
      const id = crypto.randomUUID();
      const t = nowIso();
      await db.run(
        `INSERT INTO users (id, agency_id, email, email_verified, role, status, created_at, updated_at)
         VALUES (?, ?, ?, 1, 'member', 'pending', ?, ?)`,
        id,
        agency.id,
        normalizedEmail,
        t,
        t
      );
      user = { id, email: normalizedEmail, email_verified: 1, role: "member", status: "pending" };
    }

    void normRole(user.role);
    void normStatus(user.status);

    const res = NextResponse.json({ ok: true, redirectTo: "/app/chat" });

    setSessionCookie(res, {
      agencyId: agency.id,
      agencyEmail: agency.email,
    });

    return res;
  } catch (err: any) {
    console.error("LOGIN_ERROR", err);
    return NextResponse.json(
      { error: "Server error", message: err?.message || "Unknown error" },
      { status: 500 }
    );
  }
}