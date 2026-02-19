// app/api/dev/reset-password/route.ts
// TEMP DEV-ONLY ROUTE. DELETE AFTER USE.

import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { getDb } from "@/lib/db";
import { ensureSchema } from "@/lib/schema";

export const runtime = "nodejs";

async function readBody(req: NextRequest): Promise<{ email?: string; newPassword?: string }> {
  const ct = req.headers.get("content-type") || "";
  if (ct.includes("application/json")) {
    const j = await req.json().catch(() => ({}));
    return { email: j?.email, newPassword: j?.newPassword };
  }
  const text = await req.text().catch(() => "");
  const params = new URLSearchParams(text);
  return {
    email: params.get("email") || undefined,
    newPassword: params.get("newPassword") || undefined,
  };
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
  if (!envSecret) return { ok: false as const, res: json(500, { ok: false, message: "DEV_ADMIN_SECRET is not set." }) };

  const secret = getSecret(req);
  if (!secret || secret !== envSecret) return { ok: false as const, res: json(401, { ok: false, message: "Unauthorized" }) };

  return { ok: true as const, res: null as any };
}

export async function POST(req: NextRequest) {
  try {
    await ensureSchema().catch(() => {});

    const auth = await authOr401(req);
    if (!auth.ok) return auth.res;

    const { email, newPassword } = await readBody(req);
    const normalizedEmail = (email || "").trim().toLowerCase();

    if (!normalizedEmail || !(newPassword || "").trim()) {
      return json(400, { ok: false, message: "Missing email or newPassword" });
    }

    const db = await getDb();

    // Drift-safe columns
    await db.run("ALTER TABLE agencies ADD COLUMN password_hash TEXT").catch(() => {});
    await db.run("ALTER TABLE agencies ADD COLUMN email_verified INTEGER").catch(() => {});
    await db.run("ALTER TABLE agencies ADD COLUMN updated_at TEXT").catch(() => {});

    const agency = await db.get<{ id: string }>(
      "SELECT id FROM agencies WHERE lower(email) = ? LIMIT 1",
      normalizedEmail
    );

    if (!agency?.id) {
      return json(404, { ok: false, message: "No agency found for that email" });
    }

    const password_hash = await bcrypt.hash(newPassword!, 10);

    await db.run(
      "UPDATE agencies SET password_hash = ?, email_verified = 1, updated_at = ? WHERE id = ?",
      password_hash,
      new Date().toISOString(),
      agency.id
    );

    // Best-effort user row
    await db.run("ALTER TABLE users ADD COLUMN email_verified INTEGER").catch(() => {});
    await db.run("ALTER TABLE users ADD COLUMN status TEXT").catch(() => {});
    await db.run(
      "UPDATE users SET email_verified = 1, status = COALESCE(status, 'active') WHERE agency_id = ? AND lower(email) = ?",
      agency.id,
      normalizedEmail
    ).catch(() => {});

    return json(200, { ok: true, message: "Password reset successfully (dev route). You can now login." });
  } catch (err: any) {
    console.error("DEV_RESET_PASSWORD_ERROR", err);
    return json(500, { ok: false, message: err?.message || "Server error" });
  }
}

// GET = status check
export async function GET(req: NextRequest) {
  const auth = await authOr401(req);
  if (!auth.ok) return auth.res;
  return json(200, { ok: true, message: "Dev reset route ready" });
}

// NEW: list the most recent agencies (emails) so you can pick the right one
export async function PUT(req: NextRequest) {
  try {
    await ensureSchema().catch(() => {});

    const auth = await authOr401(req);
    if (!auth.ok) return auth.res;

    const db = await getDb();

    // Best effort: in case created_at doesn't exist yet
    await db.run("ALTER TABLE agencies ADD COLUMN created_at TEXT").catch(() => {});
    await db.run("ALTER TABLE agencies ADD COLUMN name TEXT").catch(() => {});
    await db.run("ALTER TABLE agencies ADD COLUMN email TEXT").catch(() => {});

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
