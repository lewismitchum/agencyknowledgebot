import { NextRequest, NextResponse } from "next/server";
import { getDb, type Db } from "@/lib/db";
import { hashToken } from "@/lib/tokens";

async function ensureUserRoleColumns(db: Db) {
  try {
    await db.run("ALTER TABLE users ADD COLUMN role TEXT");
  } catch {}
  try {
    await db.run("ALTER TABLE users ADD COLUMN status TEXT");
  } catch {}
}

export async function POST(req: NextRequest) {
  const { token } = await req.json().catch(() => ({}));
  if (!token) return NextResponse.json({ error: "Missing token" }, { status: 400 });

  const db: Db = await getDb();
  await ensureUserRoleColumns(db);

  const tokenHash = hashToken(token);

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

  if (agency.email_verified === 1) {
    // Still ensure owner user is active (idempotent)
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

  const exp = agency.email_verify_expires_at
    ? new Date(agency.email_verify_expires_at).getTime()
    : 0;

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

  // ✅ Activate owner identity
  await db.run(
    `UPDATE users
     SET email_verified = 1,
         role = 'owner',
         status = 'active'
     WHERE agency_id = ? AND lower(email) = lower(?)`,
    agency.id,
    agency.email
  );

  return NextResponse.json({ ok: true });
}
