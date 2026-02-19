import { NextRequest } from "next/server";
import { getDb, type Db } from "@/lib/db";
import { requireOwner } from "@/lib/authz";
import { ensureSchema } from "@/lib/schema";

export const runtime = "nodejs";

function todayYmd() {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(
    d.getUTCDate()
  ).padStart(2, "0")}`;
}

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireOwner(req);

    const db: Db = await getDb();
    await ensureSchema(db);

    const planRow = await db.get(
      `SELECT plan FROM agencies WHERE id = ? LIMIT 1`,
      ctx.agencyId
    );

    const botCounts = await db.get(
      `SELECT 
         SUM(CASE WHEN owner_user_id IS NULL THEN 1 ELSE 0 END) as agency_bots,
         SUM(CASE WHEN owner_user_id IS NOT NULL THEN 1 ELSE 0 END) as private_bots,
         SUM(CASE WHEN vector_store_id IS NULL THEN 1 ELSE 0 END) as missing_vector_store
       FROM bots
       WHERE agency_id = ?`,
      ctx.agencyId
    );

    const usage = await db.get(
      `SELECT messages_count, uploads_count
       FROM usage_daily
       WHERE agency_id = ? AND date = ?
       LIMIT 1`,
      ctx.agencyId,
      todayYmd()
    );

    return Response.json({
      ok: true,
      plan: planRow?.plan ?? "unknown",
      bots: botCounts ?? {},
      usage_today: usage ?? { messages_count: 0, uploads_count: 0 },
    });
  } catch (err: any) {
    const code = String(err?.code ?? err?.message ?? err);
    if (code === "UNAUTHENTICATED")
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    if (code === "FORBIDDEN_NOT_OWNER")
      return Response.json({ error: "Owner only" }, { status: 403 });

    return Response.json(
      { error: "Server error", message: String(err?.message ?? err) },
      { status: 500 }
    );
  }
}
