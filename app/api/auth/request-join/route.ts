// app/api/auth/request-join/route.ts
import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import { getDb, type Db } from "@/lib/db";
import { ensureSchema } from "@/lib/schema";
import { nowIso } from "@/lib/tokens";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function ensureUserColumns(db: Db) {
  await db.run("ALTER TABLE users ADD COLUMN role TEXT").catch(() => {});
  await db.run("ALTER TABLE users ADD COLUMN status TEXT").catch(() => {});
  await db.run("ALTER TABLE users ADD COLUMN created_at TEXT").catch(() => {});
  await db.run("ALTER TABLE users ADD COLUMN updated_at TEXT").catch(() => {});
  await db.run("ALTER TABLE users ADD COLUMN email_verified INTEGER").catch(() => {});
  await db.run("ALTER TABLE users ADD COLUMN password_hash TEXT").catch(() => {});
  await db.run("ALTER TABLE agencies ADD COLUMN name TEXT").catch(() => {});
}

function isEmail(s: string) {
  const v = String(s ?? "").trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

async function readBody(req: NextRequest) {
  const ct = req.headers.get("content-type") || "";
  if (ct.includes("application/json")) {
    const j = await req.json().catch(() => ({}));
    return {
      agency_email: j?.agency_email,
      agency_name: j?.agency_name,
      email: j?.email,
      password: j?.password,
      isJson: true as const,
    };
  }
  const text = await req.text().catch(() => "");
  const params = new URLSearchParams(text);
  return {
    agency_email: params.get("agency_email"),
    agency_name: params.get("agency_name"),
    email: params.get("email"),
    password: params.get("password"),
    isJson: false as const,
  };
}

export async function POST(req: NextRequest) {
  try {
    const db: Db = await getDb();
    await ensureSchema(db);
    await ensureUserColumns(db);

    const { agency_email, agency_name, email, password, isJson } = await readBody(req);

    const agencyEmail = String(agency_email ?? "").trim().toLowerCase();
    const agencyName = String(agency_name ?? "").trim();
    const userEmail = String(email ?? "").trim().toLowerCase();
    const pw = String(password ?? "").trim();

    if (!isEmail(userEmail)) {
      return NextResponse.json({ ok: false, error: "INVALID_EMAIL" }, { status: 400 });
    }
    if (!pw || pw.length < 8) {
      return NextResponse.json({ ok: false, error: "PASSWORD_TOO_SHORT" }, { status: 400 });
    }
    if (!agencyEmail && !agencyName) {
      return NextResponse.json({ ok: false, error: "MISSING_AGENCY" }, { status: 400 });
    }

    // Find agency by email or name
    let agency:
      | { id: string; email: string; name: string | null }
      | undefined;

    if (agencyEmail) {
      agency = (await db.get(
        `SELECT id, email, name
         FROM agencies
         WHERE lower(email) = lower(?)
         LIMIT 1`,
        agencyEmail
      )) as any;
    } else {
      agency = (await db.get(
        `SELECT id, email, name
         FROM agencies
         WHERE lower(name) = lower(?)
         LIMIT 1`,
        agencyName
      )) as any;
    }

    if (!agency?.id) {
      return NextResponse.json({ ok: false, error: "AGENCY_NOT_FOUND" }, { status: 404 });
    }

    // Block if user email already exists anywhere (prevents cross-agency confusion)
    const existingUser = (await db.get(
      `SELECT id, agency_id
       FROM users
       WHERE lower(email) = lower(?)
       LIMIT 1`,
      userEmail
    )) as { id: string; agency_id: string } | undefined;

    if (existingUser?.id) {
      // If they already belong to this agency, tell them.
      if (existingUser.agency_id === agency.id) {
        return NextResponse.json({ ok: false, error: "USER_ALREADY_EXISTS" }, { status: 409 });
      }
      return NextResponse.json({ ok: false, error: "EMAIL_ALREADY_IN_USE" }, { status: 409 });
    }

    // Create as PENDING member. Owner/admin must activate.
    const userId = randomUUID();
    const password_hash = await bcrypt.hash(pw, 10);
    const ts = nowIso();

    await db.run(
      `INSERT INTO users (id, agency_id, email, email_verified, role, status, password_hash, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      userId,
      agency.id,
      userEmail,
      1,
      "member",
      "pending",
      password_hash,
      ts,
      ts
    );

    // Do NOT set session cookie; they are pending.
    // Return enough info for UI to show "Request sent".
    const payload = {
      ok: true,
      status: "pending",
      agency: { id: agency.id, email: agency.email, name: agency.name ?? null },
      message: "Join request submitted. An owner/admin must approve you.",
    };

    if (isJson) return NextResponse.json(payload);

    return NextResponse.redirect(new URL("/pending-approval", req.url));
  } catch (err: any) {
    console.error("REQUEST_JOIN_ERROR", err);
    return NextResponse.json(
      { ok: false, error: "Server error", message: String(err?.message ?? err) },
      { status: 500 }
    );
  }
}