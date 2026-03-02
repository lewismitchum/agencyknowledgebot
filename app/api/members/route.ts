// app/api/members/route.ts
import type { NextRequest } from "next/server";
import { getDb, type Db } from "@/lib/db";
import { requireOwner } from "@/lib/authz";
import { ensureSchema } from "@/lib/schema";

export const runtime = "nodejs";

async function ensureUserColumns(db: Db) {
  await db.run("ALTER TABLE users ADD COLUMN role TEXT").catch(() => {});
  await db.run("ALTER TABLE users ADD COLUMN status TEXT").catch(() => {});
  await db.run("ALTER TABLE users ADD COLUMN created_at TEXT").catch(() => {});
  await db.run("ALTER TABLE users ADD COLUMN updated_at TEXT").catch(() => {});
  await db.run("ALTER TABLE users ADD COLUMN email_verified INTEGER").catch(() => {});
}

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireOwner(req);
    const db: Db = await getDb();

    await ensureSchema(db);
    await ensureUserColumns(db);

    const users = (await db.all(
      `SELECT id, email, email_verified, role, status, created_at, updated_at
       FROM users
       WHERE agency_id = ?
       ORDER BY
         CASE
           WHEN COALESCE(status,'pending') = 'pending' THEN 0
           WHEN COALESCE(status,'pending') = 'active' THEN 1
           WHEN COALESCE(status,'pending') = 'blocked' THEN 2
           ELSE 3
         END,
         lower(email) ASC`,
      ctx.agencyId
    )) as Array<{
      id: string;
      email: string;
      email_verified: number | null;
      role: string | null;
      status: string | null;
      created_at: string | null;
      updated_at: string | null;
    }>;

    return Response.json({ ok: true, users: users ?? [] });
  } catch (err: any) {
    const msg = String(err?.code ?? err?.message ?? err);

    if (msg === "UNAUTHENTICATED") return Response.json({ error: "Unauthorized" }, { status: 401 });
    if (msg === "FORBIDDEN_NOT_ACTIVE") return Response.json({ error: "Pending approval" }, { status: 403 });
    if (msg === "FORBIDDEN_NOT_OWNER") return Response.json({ error: "Owner only" }, { status: 403 });

    console.error("MEMBERS_GET_ERROR", err);
    return Response.json({ error: "Server error", message: msg }, { status: 500 });
  }
}