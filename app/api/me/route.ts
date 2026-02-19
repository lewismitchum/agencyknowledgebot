import { NextRequest } from "next/server";
import { getDb, type Db } from "@/lib/db";
import { ensureSchema } from "@/lib/schema";
import { requireActiveMember } from "@/lib/authz";
import { getPlanLimits, normalizePlan } from "@/lib/plans";

export const runtime = "nodejs";

function todayYmd() {
  const d = new Date();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireActiveMember(req);

    const db: Db = await getDb();
    await ensureSchema(db);

    const agency = (await db.get(
      `SELECT id, name, email, plan
       FROM agencies
       WHERE id = ?
       LIMIT 1`,
      ctx.agencyId
    )) as { id: string; name: string; email: string; plan: string | null } | undefined;

    const plan = normalizePlan(agency?.plan ?? ctx.plan ?? null);
    const limits = getPlanLimits(plan);

    const usage = (await db.get(
      `SELECT messages_count, uploads_count
       FROM usage_daily
       WHERE agency_id = ? AND date = ?
       LIMIT 1`,
      ctx.agencyId,
      todayYmd()
    )) as { messages_count: number; uploads_count: number } | undefined;

    return Response.json({
      ok: true,
      agency: {
        id: ctx.agencyId,
        name: agency?.name ?? null,
        email: agency?.email ?? ctx.agencyEmail ?? null,
        plan,
      },
      user: {
        id: ctx.userId,
      },
      limits,
      usage_today: {
        messages_count: Number(usage?.messages_count ?? 0),
        uploads_count: Number(usage?.uploads_count ?? 0),
      },
    });
  } catch (err: any) {
    const code = String(err?.code ?? err?.message ?? err);
    if (code === "UNAUTHENTICATED") return Response.json({ error: "Unauthorized" }, { status: 401 });
    if (code === "FORBIDDEN_NOT_ACTIVE") return Response.json({ error: "Forbidden" }, { status: 403 });

    return Response.json(
      { error: "Server error", message: String(err?.message ?? err) },
      { status: 500 }
    );
  }
}
