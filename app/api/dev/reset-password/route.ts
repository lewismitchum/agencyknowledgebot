// app/api/dev/reset-password/route.ts
// TEMP DEV-ONLY ROUTE. DELETE AFTER USE.

import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { getDb } from "@/lib/db";
import { ensureSchema } from "@/lib/schema";

export const runtime = "nodejs";

async function readJson(req: NextRequest): Promise<any> {
  const ct = req.headers.get("content-type") || "";
  if (ct.includes("application/json")) {
    return await req.json().catch(() => ({}));
  }
  const text = await req.text().catch(() => "");
  const params = new URLSearchParams(text);
  const obj: Record<string, any> = {};
  for (const [k, v] of params.entries()) obj[k] = v;
  return obj;
}

function getSecret(req: NextRequest) {
  return req.headers.get("x-dev-admin-secret") || new URL(req.url).searchParams.get("secret") || "";
}

function json(status: number, data: any) {
  return new NextResponse(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function authOr401(req: NextRequest) {
  const envSecret = process.env.DEV_ADMIN_SECRET || "";
  if (!envSecret) {
    return { ok: false as const, res: json(500, { ok: false, message: "DEV_ADMIN_SECRET is not set." }) };
  }
  const secret = getSecret(req);
  if (!secret || secret !== envSecret) {
    return { ok: false as const, res: json(401, { ok: false, message: "Unauthorized" }) };
  }
  return { ok: true as const, res: null as any };
}

async function ensureAgencyColumns(db: any) {
  await db.run("ALTER TABLE agencies ADD COLUMN name TEXT").catch(() => {});
  await db.run("ALTER TABLE agencies ADD COLUMN email TEXT").catch(() => {});
  await db.run("ALTER TABLE agencies ADD COLUMN password_hash TEXT").catch(() => {});
  await db.run("ALTER TABLE agencies ADD COLUMN email_verified INTEGER").catch(() => {});
  await db.run("ALTER TABLE agencies ADD COLUMN created_at TEXT").catch(() => {});
  await db.run("ALTER TABLE agencies ADD COLUMN updated_at TEXT").catch(() => {});
}

async function ensureUserColumns(db: any) {
  await db.run("ALTER TABLE users ADD COLUMN email TEXT").catch(() => {});
  await db.run("ALTER TABLE users ADD COLUMN email_verified INTEGER").catch(() => {});
  await db.run("ALTER TABLE users ADD COLUMN status TEXT").catch(() => {});
  await db.run("ALTER TABLE users ADD COLUMN updated_at TEXT").catch(() => {});
}

export async function GET(req: NextRequest) {
  const auth = await authOr401(req);
  if (!auth.ok) return auth.res;
  return json(200, { ok: true, message: "Dev reset route ready" });
}

// Reset password (by agency email)
export async function POST(req: NextRequest) {
  try {
    await ensureSchema().catch(() => {});
    const auth = await authOr401(req);
    if (!auth.ok) return auth.res;

    const body = await readJson(req);
    const email = String(body?.email || "").trim().toLowerCase();
    const newPassword = String(body?.newPassword || "");

    if (!email || !newPassword.trim()) {
      return json(400, { ok: false, message: "Missing email or newPassword" });
    }

    const db = await getDb();
    await ensureAgencyColumns(db);
    await ensureUserColumns(db);

    const agency = await db.get<{ id: string }>(
      "SELECT id FROM agencies WHERE lower(email) = ? LIMIT 1",
      email
    );

    if (!agency?.id) {
      return json(404, { ok: false, message: "No agency found for that email" });
    }

    const password_hash = await bcrypt.hash(newPassword, 10);

    await db.run(
      "UPDATE agencies SET password_hash = ?, email_verified = 1, updated_at = ? WHERE id = ?",
      password_hash,
      new Date().toISOString(),
      agency.id
    );

    // Best-effort: mark the matching user row verified/active
    await db.run(
      "UPDATE users SET email_verified = 1, status = COALESCE(status, 'active'), updated_at = ? WHERE agency_id = ? AND lower(email) = ?",
      new Date().toISOString(),
      agency.id,
      email
    ).catch(() => {});

    return json(200, { ok: true, message: "Password reset successfully (dev route). You can now login." });
  } catch (err: any) {
    console.error("DEV_RESET_PASSWORD_ERROR", err);
    return json(500, { ok: false, message: err?.message || "Server error" });
  }
}

// List agencies (debug)
export async function PUT(req: NextRequest) {
  try {
    await ensureSchema().catch(() => {});
    const auth = await authOr401(req);
    if (!auth.ok) return auth.res;

    const db = await getDb();
    await ensureAgencyColumns(db);

    const rows = await db.all<{
      id: string;
      name: string | null;
      email: string | null;
      created_at: string | null;
      email_verified: number | null;
    }>(
      `SELECT id, name, email, created_at, email_verified
       FROM agencies
       ORDER BY COALESCE(created_at, '') DESC
       LIMIT 25`
    );

    return json(200, { ok: true, agencies: rows });
  } catch (err: any) {
    console.error("DEV_LIST_AGENCIES_ERROR", err);
    return json(500, { ok: false, message: err?.message || "Server error" });
  }
}

// Rename agency email (and matching user email within that agency)
export async function PATCH(req: NextRequest) {
  try {
    await ensureSchema().catch(() => {});
    const auth = await authOr401(req);
    if (!auth.ok) return auth.res;

    const body = await readJson(req);
    const oldEmail = String(body?.oldEmail || "").trim().toLowerCase();
    const newEmail = String(body?.newEmail || "").trim().toLowerCase();

    if (!oldEmail || !newEmail) {
      return json(400, { ok: false, message: "Missing oldEmail or newEmail" });
    }

    const db = await getDb();
    await ensureAgencyColumns(db);
    await ensureUserColumns(db);

    const existingNew = await db.get<{ id: string }>(
      "SELECT id FROM agencies WHERE lower(email) = ? LIMIT 1",
      newEmail
    );
    if (existingNew?.id) {
      return json(409, { ok: false, message: "New email is already in use (agencies)." });
    }

    const agency = await db.get<{ id: string; email: string }>(
      "SELECT id, email FROM agencies WHERE lower(email) = ? LIMIT 1",
      oldEmail
    );
    if (!agency?.id) {
      return json(404, { ok: false, message: "No agency found for oldEmail" });
    }

    const t = new Date().toISOString();

    await db.run(
      "UPDATE agencies SET email = ?, updated_at = ? WHERE id = ?",
      newEmail,
      t,
      agency.id
    );

    // Update matching user row inside same agency (best-effort)
    await db.run(
      "UPDATE users SET email = ?, updated_at = ? WHERE agency_id = ? AND lower(email) = ?",
      newEmail,
      t,
      agency.id,
      oldEmail
    ).catch(() => {});

    return json(200, {
      ok: true,
      message: "Renamed agency email. Log out and log back in with the new email.",
      agencyId: agency.id,
      oldEmail,
      newEmail,
    });
  } catch (err: any) {
    console.error("DEV_RENAME_AGENCY_EMAIL_ERROR", err);
    return json(500, { ok: false, message: err?.message || "Server error" });
  }
}
