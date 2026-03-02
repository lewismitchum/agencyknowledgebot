// app/api/email/threads/[threadId]/route.ts
import type { NextRequest } from "next/server";
import { getDb, type Db } from "@/lib/db";
import { ensureSchema } from "@/lib/schema";
import { requireActiveMember } from "@/lib/authz";
import { getAgencyPlan } from "@/lib/enforcement";
import { normalizePlan, requireFeature } from "@/lib/plans";
import { ensureFreshAccessToken, getThread } from "@/lib/gmail";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ threadId: string }> };

export async function OPTIONS() {
  return new Response(null, { status: 204 });
}

export async function GET(req: NextRequest, ctx2: Ctx) {
  try {
    const ctx = await requireActiveMember(req);
    const { threadId } = await ctx2.params;

    const db: Db = await getDb();
    await ensureSchema(db);

    const rawPlan = await getAgencyPlan(db, ctx.agencyId, ctx.plan);
    const planKey = normalizePlan(rawPlan);
    const gate = requireFeature(planKey, "email");
    if (!gate.ok) return Response.json(gate.body, { status: gate.status });

    const acc = (await db.get(
      `SELECT id, provider, access_token, refresh_token, token_expires_at
       FROM email_accounts
       WHERE agency_id = ? AND user_id = ?
       ORDER BY updated_at DESC
       LIMIT 1`,
      ctx.agencyId,
      ctx.userId
    )) as
      | {
          id: string;
          provider: string;
          access_token: string | null;
          refresh_token: string | null;
          token_expires_at: string | null;
        }
      | undefined;

    if (!acc?.id || acc.provider !== "google") {
      return Response.json({ ok: false, error: "NOT_CONNECTED" }, { status: 409 });
    }

    const tok = await ensureFreshAccessToken({
      access_token: acc.access_token,
      token_expires_at: acc.token_expires_at,
      refresh_token: acc.refresh_token,
      onUpdate: async (t) => {
        await db.run(
          `UPDATE email_accounts
           SET access_token = ?, token_expires_at = ?, scope = COALESCE(scope, ?), updated_at = datetime('now')
           WHERE id = ? AND agency_id = ? AND user_id = ?`,
          t.access_token,
          t.token_expires_at || null,
          t.scope || null,
          acc.id,
          ctx.agencyId,
          ctx.userId
        );
      },
    });

    if (!tok.ok) {
      return Response.json({ ok: false, error: tok.error }, { status: 409 });
    }

    const t = await getThread(tok.access_token, threadId);
    if (!t.ok) {
      return Response.json({ ok: false, error: t.error, details: (t as any).details }, { status: 502 });
    }

    return Response.json({ ok: true, thread: t.thread }, { status: 200 });
  } catch (err: any) {
    const msg = String(err?.code ?? err?.message ?? err);
    if (msg === "UNAUTHENTICATED") return Response.json({ error: "Unauthorized" }, { status: 401 });
    if (msg === "FORBIDDEN_NOT_ACTIVE") return Response.json({ error: "Forbidden" }, { status: 403 });
    return Response.json({ error: "Server error", message: msg }, { status: 500 });
  }
}