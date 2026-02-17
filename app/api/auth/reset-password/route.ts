import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { hashToken } from "@/lib/tokens";
import bcrypt from "bcryptjs";
import { ensureSchema } from "@/lib/schema";

export async function POST(req: NextRequest) {
  const { token, password } = await req.json().catch(() => ({}));

  if (!token || !password?.trim()) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }

  const db = await getDb();
  const tokenHash = hashToken(token);

  const agency = await db.get(
    `SELECT id, password_reset_expires_at
     FROM agencies
     WHERE password_reset_token_hash = ?`,
    tokenHash
  );

  if (!agency) {
    return NextResponse.json({ error: "Invalid or expired link" }, { status: 400 });
  }

  const exp = agency.password_reset_expires_at ? new Date(agency.password_reset_expires_at).getTime() : 0;
  if (!exp || Date.now() > exp) {
    return NextResponse.json({ error: "Invalid or expired link" }, { status: 400 });
  }

  const password_hash = await bcrypt.hash(password, 10);

  await db.run(
    `UPDATE agencies
     SET password_hash = ?,
         password_reset_token_hash = NULL,
         password_reset_expires_at = NULL
     WHERE id = ?`,
    password_hash,
    agency.id
  );

  return NextResponse.json({ ok: true });
}
