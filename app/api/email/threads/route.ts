// app/api/email/threads/route.ts
import type { NextRequest } from "next/server";
import { getDb, type Db } from "@/lib/db";
import { ensureSchema } from "@/lib/schema";
import { requireActiveMember } from "@/lib/authz";
import { getAgencyPlan } from "@/lib/enforcement";
import { normalizePlan, requireFeature } from "@/lib/plans";
import { ensureFreshAccessToken, listThreads, getThread } from "@/lib/gmail";

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

    const url = new URL(req.url);
    const max = Number(url.searchParams.get("max") || "20");

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

    const lt = await listThreads(tok.access_token, max);
    if (!lt.ok) {
      return Response.json({ ok: false, error: lt.error, details: lt.details }, { status: 502 });
    }

    // Fetch metadata for top N threads (cheap format=metadata)
    const ids = lt.thread_ids.slice(0, Math.max(1, Math.min(20, Math.floor(max || 20))));
    const out: any[] = [];

    for (const id of ids) {
      const t = await getThread(tok.access_token, id);
      if (t.ok) {
        out.push({
          id: t.thread.id,
          subject: t.thread.subject,
          last_from: t.thread.last_from,
          last_snippet: t.thread.last_snippet,
          messages_count: t.thread.messages.length,
        });
      }
    }

    return Response.json({ ok: true, threads: out }, { status: 200 });
  } catch (err: any) {
    const msg = String(err?.code ?? err?.message ?? err);
    if (msg === "UNAUTHENTICATED") return Response.json({ error: "Unauthorized" }, { status: 401 });
    if (msg === "FORBIDDEN_NOT_ACTIVE") return Response.json({ error: "Forbidden" }, { status: 403 });
    return Response.json({ error: "Server error", message: msg }, { status: 500 });
  }
}