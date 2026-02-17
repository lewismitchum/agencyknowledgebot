import { NextRequest } from "next/server";
import { getDb, type Db } from "@/lib/db";
import { requireOwner } from "@/lib/authz";

export const runtime = "nodejs";

async function ensureUserRoleColumns(db: Db) {
  try {
    await db.run("ALTER TABLE users ADD COLUMN role TEXT");
  } catch {}
  try {
    await db.run("ALTER TABLE users ADD COLUMN status TEXT");
  } catch {}
}

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireOwner(req);
    const db: Db = await getDb();

    await ensureUserRoleColumns(db);

    const users = (await db.all(
      `SELECT id, email, email_verified, role, status, created_at, updated_at
       FROM users
       WHERE agency_id = ?
       ORDER BY
         CASE
           WHEN status = 'pending' THEN 0
           WHEN status = 'active' THEN 1
           WHEN status = 'blocked' THEN 2
           ELSE 3
         END,
         lower(email) ASC`,
      ctx.agencyId
    )) as Array<{
      id: string;
      email: string;
      email_verified: number;
      role: string | null;
      status: string | null;
      created_at: string;
      updated_at: string;
    }>;

    return Response.json({ ok: true, users: users ?? [] });
  } catch (err: any) {
    const msg = String(err?.message ?? err);
    if (msg === "UNAUTHENTICATED") return Response.json({ error: "Unauthorized" }, { status: 401 });
    if (msg === "FORBIDDEN_NOT_ACTIVE") return Response.json({ error: "Pending approval" }, { status: 403 });
    if (msg === "FORBIDDEN_NOT_OWNER") return Response.json({ error: "Owner only" }, { status: 403 });
    return Response.json({ error: "Server error", message: msg }, { status: 500 });
  }
}
