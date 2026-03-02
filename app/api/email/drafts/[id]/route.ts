// app/api/email/drafts/[id]/route.ts
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

export async function GET(req: NextRequest, ctx2: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireActiveMember(req);
    const db: Db = await getDb();
    await ensureSchema(db);

    const rawPlan = await getAgencyPlan(db, ctx.agencyId, ctx.plan);
    const planKey = normalizePlan(rawPlan);

    const gate = requireFeature(planKey, "email");
    if (!gate.ok) return Response.json(gate.body, { status: gate.status });

    const { id } = await ctx2.params;
    const draftId = String(id || "").trim();
    if (!draftId) return Response.json({ ok: false, error: "MISSING_ID" }, { status: 400 });

    const row = (await db.get(
      `
      SELECT id, bot_id, subject, body, created_at
      FROM email_drafts
      WHERE id = ?
        AND agency_id = ?
        AND (
          user_id = ?
          OR created_by_user_id = ?
        )
      LIMIT 1
      `,
      draftId,
      ctx.agencyId,
      ctx.userId,
      ctx.userId
    )) as
      | { id: string; bot_id: string; subject: string; body: string; created_at: string }
      | undefined;

    if (!row) return Response.json({ ok: false, error: "NOT_FOUND" }, { status: 404 });

    return Response.json({
      ok: true,
      plan: planKey,
      draft: {
        id: row.id,
        bot_id: row.bot_id,
        subject: row.subject,
        body: row.body,
        created_at: row.created_at,
      },
    });
  } catch (err: any) {
    const msg = String(err?.code ?? err?.message ?? err);
    if (msg === "UNAUTHENTICATED") return Response.json({ error: "Unauthorized" }, { status: 401 });
    if (msg === "FORBIDDEN_NOT_ACTIVE") return Response.json({ error: "Forbidden" }, { status: 403 });
    return Response.json({ error: "Server error", message: msg }, { status: 500 });
  }
}