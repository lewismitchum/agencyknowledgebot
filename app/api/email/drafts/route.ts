// app/api/email/drafts/route.ts
import type { NextRequest } from "next/server";
import { getDb, type Db } from "@/lib/db";
import { requireActiveMember } from "@/lib/authz";
import { ensureSchema } from "@/lib/schema";
import { getAgencyPlan } from "@/lib/enforcement";
import { normalizePlan, requireFeature } from "@/lib/plans";

export const runtime = "nodejs";

export async function OPTIONS() {
  return new Response(null, { status: 204 });
}

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireActiveMember(req);
    const db: Db = await getDb();
    await ensureSchema(db);

    const plan = await getAgencyPlan(db, ctx.agencyId, ctx.plan);
    const planKey = normalizePlan(plan);

    const gate = requireFeature(planKey, "email");
    if (!gate.ok) return Response.json(gate.body, { status: gate.status });

    // Drift-safe: prefer canonical user_id, fallback to legacy created_by_user_id.
    const rows = (await db.all(
      `
      SELECT id, bot_id, subject, created_at
      FROM email_drafts
      WHERE agency_id = ?
        AND (COALESCE(user_id, created_by_user_id) = ?)
      ORDER BY created_at DESC
      LIMIT 50
      `,
      ctx.agencyId,
      ctx.userId
    )) as Array<{ id: string; bot_id: string; subject: string; created_at: string }>;

    return Response.json({ ok: true, plan: planKey, drafts: rows || [] });
  } catch (err: any) {
    const msg = String(err?.code ?? err?.message ?? err);
    if (msg === "UNAUTHENTICATED") return Response.json({ error: "Unauthorized" }, { status: 401 });
    if (msg === "FORBIDDEN_NOT_ACTIVE") return Response.json({ error: "Forbidden" }, { status: 403 });

    console.error("EMAIL_DRAFTS_GET_ERROR", err);
    return Response.json({ error: "Server error", message: msg }, { status: 500 });
  }
}

export async function POST() {
  return Response.json({ error: "METHOD_NOT_ALLOWED" }, { status: 405 });
}