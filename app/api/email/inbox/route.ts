// app/api/email/inbox/route.ts
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
    if (!gate.ok) {
      return Response.json(
        {
          ok: false,
          plan: planKey,
          upsell: {
            code: "PLAN_REQUIRED",
            message: "Email inbox is available on Corporation. Upgrade to unlock inbox + Gmail connection.",
          },
        },
        { status: 200 }
      );
    }

    // Stub payload for now. Later: pull connected mailbox threads.
    return Response.json(
      {
        ok: true,
        plan: planKey,
        connected: false,
        provider: null,
        message: "Inbox is not connected yet. Gmail OAuth is coming next.",
        threads: [],
      },
      { status: 200 }
    );
  } catch (err: any) {
    const msg = String(err?.code ?? err?.message ?? err);
    if (msg === "UNAUTHENTICATED") return Response.json({ error: "Unauthorized" }, { status: 401 });
    if (msg === "FORBIDDEN_NOT_ACTIVE") return Response.json({ error: "Forbidden" }, { status: 403 });
    return Response.json({ error: "Server error", message: msg }, { status: 500 });
  }
}