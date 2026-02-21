// app/api/auth/verify-email/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getDb, type Db } from "@/lib/db";
import { ensureSchema } from "@/lib/schema";
import { hashToken } from "@/lib/tokens";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function ensureUserRoleColumns(db: Db) {
  try {
    await db.run("ALTER TABLE users ADD COLUMN role TEXT");
  } catch {}
  try {
    await db.run("ALTER TABLE users ADD COLUMN status TEXT");
  } catch {}
  try {
    await db.run("ALTER TABLE users ADD COLUMN email_verified INTEGER");
  } catch {}
}

export async function POST(req: NextRequest) {
  const { token } = await req.json().catch(() => ({}));
  const t = String(token || "").trim();
  if (!t) return NextResponse.json({ error: "Missing token" }, { status: 400 });

  const db: Db = await getDb();
  await ensureSchema(db);
  await ensureUserRoleColumns(db);

  const tokenHash = hashToken(t);

  const agency = (await db.get(
    `SELECT id, email, email_verify_expires_at, email_verified
     FROM agencies
     WHERE email_verify_token_hash = ?
     LIMIT 1`,
    tokenHash
  )) as
    | {
        id: string;
        email: string;
        email_verify_expires_at: string | null;
        email_verified: number;
      }
    | undefined;

  if (!agency?.id) {
    return NextResponse.json({ error: "Invalid or expired link" }, { status: 400 });
  }

  const exp = agency.email_verify_expires_at
    ? new Date(agency.email_verify_expires_at).getTime()
    : 0;

  if (!agency.email_verified) {
    if (!exp || Date.now() > exp) {
      return NextResponse.json({ error: "Invalid or expired link" }, { status: 400 });
    }

    await db.run(
      `UPDATE agencies
       SET email_verified = 1,
           email_verify_token_hash = NULL,
           email_verify_expires_at = NULL
       WHERE id = ?`,
      agency.id
    );
  }

  // Always ensure owner identity is active (idempotent)
  await db.run(
    `UPDATE users
     SET email_verified = 1,
         role = coalesce(role, 'owner'),
         status = 'active'
     WHERE agency_id = ? AND lower(email) = lower(?)`,
    agency.id,
    agency.email
  );

  return NextResponse.json({ ok: true });
}