// app/api/auth/login/route.ts
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { getDb, type Db } from "@/lib/db";
import { setSessionCookie } from "@/lib/session";
import { ensureSchema } from "@/lib/schema";

export const runtime = "nodejs";

async function readBody(req: NextRequest): Promise<{ email?: string; password?: string }> {
  const ct = req.headers.get("content-type") || "";
  if (ct.includes("application/json")) {
    const j = await req.json().catch(() => ({}));
    return { email: j?.email, password: j?.password };
  }
  const text = await req.text().catch(() => "");
  const params = new URLSearchParams(text);
  return {
    email: params.get("email") || undefined,
    password: params.get("password") || undefined,
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
    await ensureSchema().catch(() => {}); // harmless if already run elsewhere

    const { email, password } = await readBody(req);

    if (!email?.trim() || !password?.trim()) {
      return NextResponse.json({ error: "Missing fields" }, { status: 400 });
    }

    const db: Db = await getDb();
    const normalizedEmail = email.trim().toLowerCase();

    const agency = (await db.get(
      "SELECT id, email, password_hash, email_verified FROM agencies WHERE email = ?",
      normalizedEmail
    )) as
      | { id: string; email: string; password_hash: string; email_verified: number }
      | undefined;

    if (!agency) {
      return NextResponse.json({ error: "Invalid email or password" }, { status: 401 });
    }

    const ok = await bcrypt.compare(password, agency.password_hash);
    if (!ok) {
      return NextResponse.json({ error: "Invalid email or password" }, { status: 401 });
    }

    if (agency.email_verified === 0) {
      return NextResponse.json({ error: "Please verify your email before logging in." }, { status: 403 });
    }

    // ✅ Ensure first owner exists (agency email owner)
    await ensureFirstOwner(db, { id: agency.id, email: agency.email });

    // ✅ Load the actual user row for this email inside this agency
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

    // Safety: if somehow missing, create as pending member (never auto-owner except the first-owner rule above)
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

      user = {
        id,
        email: normalizedEmail,
        email_verified: 1,
        role: "member",
        status: "pending",
      };
    }

    // Normalize role/status (kept for DB correctness / future use)
    const role = normRole(user.role);
    const status = normStatus(user.status);

    const res = NextResponse.json({ ok: true, redirectTo: "/app/chat" });

    // ✅ Session cookie is identity-only (agencyId + agencyEmail). User/role/status are read server-side from DB.
    setSessionCookie(res, {
      agencyId: agency.id,
      agencyEmail: agency.email,
    });

    // (role/status computed above intentionally unused here to keep cookie typing consistent)

    return res;
  } catch (err: any) {
    console.error("LOGIN_ERROR", err);
    return NextResponse.json(
      { error: "Server error", message: err?.message || "Unknown error" },
      { status: 500 }
    );
  }
}
