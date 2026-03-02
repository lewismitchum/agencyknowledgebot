// app/api/email/drafts/route.ts
import type { NextRequest } from "next/server";
import { getDb, type Db } from "@/lib/db";
import { ensureSchema } from "@/lib/schema";
import { requireActiveMember } from "@/lib/authz";
import { getAgencyPlan } from "@/lib/enforcement";
import { normalizePlan, requireFeature } from "@/lib/plans";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function OPTIONS() {
  return new Response(null, { status: 204 });
}

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireActiveMember(req);
    const db: Db = await getDb();
    await ensureSchema(db);

    const rawPlan = await getAgencyPlan(db, ctx.agencyId, ctx.plan);
    const planKey = normalizePlan(rawPlan);

    const gate = requireFeature(planKey, "email");
    if (!gate.ok) return Response.json(gate.body, { status: gate.status });

    const rows = (await db.all(
      `
      SELECT id, bot_id, subject, created_at
      FROM email_drafts
      WHERE agency_id = ?
        AND (
          user_id = ?
          OR created_by_user_id = ?
        )
      ORDER BY datetime(created_at) DESC
      LIMIT 25
      `,
      ctx.agencyId,
      ctx.userId,
      ctx.userId
    )) as Array<{ id: string; bot_id: string; subject: string; created_at: string }>;

    return Response.json({ ok: true, plan: planKey, drafts: rows });
  } catch (err: any) {
    const msg = String(err?.code ?? err?.message ?? err);
    if (msg === "UNAUTHENTICATED") return Response.json({ error: "Unauthorized" }, { status: 401 });
    if (msg === "FORBIDDEN_NOT_ACTIVE") return Response.json({ error: "Forbidden" }, { status: 403 });
    return Response.json({ error: "Server error", message: msg }, { status: 500 });
  }
}