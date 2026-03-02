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

    const acc = (await db.get(
      `SELECT provider, email, token_expires_at, refresh_token
       FROM email_accounts
       WHERE agency_id = ? AND user_id = ?
       ORDER BY updated_at DESC
       LIMIT 1`,
      ctx.agencyId,
      ctx.userId
    )) as
      | { provider: string; email: string | null; token_expires_at: string | null; refresh_token: string | null }
      | undefined;

    const connected = Boolean(acc?.refresh_token || acc?.token_expires_at);
    const provider = acc?.provider ?? null;

    return Response.json(
      {
        ok: true,
        plan: planKey,
        connected,
        provider,
        email: acc?.email ?? null,
        message: connected ? "Connected." : "Not connected. Click Connect Gmail to enable inbox.",
        threads: [], // next step: list threads
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