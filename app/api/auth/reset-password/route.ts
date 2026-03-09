// app/api/auth/reset-password/route.ts
import { randomUUID } from "crypto";
import type { NextRequest } from "next/server";
import { getDb, type Db } from "@/lib/db";
import { ensureSchema } from "@/lib/schema";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  token?: string;
  new_password?: string;
};

function normalizeEmail(email: string) {
  return String(email || "").trim().toLowerCase();
}

function nowIso() {
  return new Date().toISOString();
}

function verifyResetToken(token: string) {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET_MISSING");

  const decoded = jwt.verify(token, secret) as any;

  if (!decoded || decoded.typ !== "password_reset") throw new Error("INVALID_TOKEN");
  if (decoded.kind !== "agency" && decoded.kind !== "user") throw new Error("INVALID_TOKEN");
  if (!decoded.email) throw new Error("INVALID_TOKEN");

  return { kind: decoded.kind as "agency" | "user", email: normalizeEmail(decoded.email) };
}

function validatePassword(pw: string) {
  const s = String(pw || "");
  if (s.length < 10) return "Password must be at least 10 characters.";
  return null;
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

export async function POST(req: NextRequest) {
  try {
    const db: Db = await getDb();
    await ensureSchema(db);
    await ensureUserColumns(db);
    await ensureIdentityTables(db);

    const body = (await req.json().catch(() => null)) as Body | null;
    const token = String(body?.token || "").trim();
    const newPassword = String(body?.new_password || "");

    if (!token) return Response.json({ error: "Missing token" }, { status: 400 });
    if (!newPassword) return Response.json({ error: "Missing new_password" }, { status: 400 });

    const pwErr = validatePassword(newPassword);
    if (pwErr) return Response.json({ error: pwErr }, { status: 400 });

    let payload: { kind: "agency" | "user"; email: string };
    try {
      payload = verifyResetToken(token);
    } catch (e: any) {
      const name = String(e?.name ?? "");
      const msg = String(e?.message ?? e);

      if (name === "TokenExpiredError" || msg === "jwt expired") {
        return Response.json({ error: "TOKEN_EXPIRED" }, { status: 400 });
      }

      return Response.json({ error: "INVALID_TOKEN" }, { status: 400 });
    }

    const email = normalizeEmail(payload.email);
    const password_hash = await bcrypt.hash(newPassword, 12);
    const t = nowIso();

    const existingIdentity = (await db.get(
      `SELECT id, email, password_hash, email_verified
       FROM identities
       WHERE lower(email) = lower(?)
       LIMIT 1`,
      email
    )) as
      | {
          id: string;
          email: string;
          password_hash: string | null;
          email_verified: number | null;
        }
      | undefined;

    let identityId = String(existingIdentity?.id || "").trim();

    if (identityId) {
      await db.run(
        `UPDATE identities
         SET password_hash = ?, updated_at = ?
         WHERE id = ?`,
        password_hash,
        t,
        identityId
      );
    } else {
      identityId = randomUUID();

      await db.run(
        `INSERT INTO identities (id, email, password_hash, email_verified, created_at, updated_at)
         VALUES (?, ?, ?, 1, ?, ?)`,
        identityId,
        email,
        password_hash,
        t,
        t
      );
    }

    await db.run(
      `UPDATE users
       SET password_hash = ?,
           identity_id = COALESCE(identity_id, ?),
           updated_at = COALESCE(updated_at, ?)
       WHERE lower(email) = lower(?)`,
      password_hash,
      identityId,
      t,
      email
    );

    await db.run(
      `UPDATE agencies
       SET password_hash = ?
       WHERE lower(email) = lower(?)`,
      password_hash,
      email
    );

    return Response.json({ ok: true });
  } catch (err: any) {
    const msg = String(err?.code ?? err?.message ?? err);
    if (msg === "JWT_SECRET_MISSING") {
      return Response.json({ error: msg }, { status: 500 });
    }

    console.error("RESET_PASSWORD_ERROR", err);
    return Response.json({ error: "Server error", message: msg }, { status: 500 });
  }
}

export async function GET() {
  return Response.json({ error: "METHOD_NOT_ALLOWED" }, { status: 405 });
}