// app/api/email/route.ts
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

async function ensureEmailAuthColumns(db: Db) {
  // drift-safe: only adds if missing
  await db.run(`ALTER TABLE users ADD COLUMN gmail_connected INTEGER`).catch(() => {});
  await db.run(`ALTER TABLE users ADD COLUMN gmail_connected_at TEXT`).catch(() => {});
}

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireActiveMember(req);
    const db: Db = await getDb();
    await ensureSchema(db);
    await ensureEmailAuthColumns(db);

    const rawPlan = await getAgencyPlan(db, ctx.agencyId, ctx.plan);
    const planKey = normalizePlan(rawPlan);

    const gate = requireFeature(planKey, "email");
    if (!gate.ok) {
      return Response.json({
        ok: false,
        plan: planKey,
        gmail_connected: false,
        upsell: {
          code: "PLAN_REQUIRED",
          message: "Email is available on Corporation.",
        },
      });
    }

    // If you already store OAuth tokens elsewhere, you can replace this check with:
    // SELECT 1 FROM gmail_accounts WHERE user_id = ? AND agency_id = ? LIMIT 1
    // For now, drift-safe single flag on users table.
    const row = (await db.get(
      `SELECT gmail_connected, gmail_connected_at
       FROM users
       WHERE id = ? AND agency_id = ?
       LIMIT 1`,
      ctx.userId,
      ctx.agencyId
    )) as { gmail_connected?: number | null; gmail_connected_at?: string | null } | undefined;

    const connected = Number(row?.gmail_connected ?? 0) === 1;

    return Response.json({
      ok: true,
      plan: planKey,
      gmail_connected: connected,
      gmail_connected_at: row?.gmail_connected_at ?? null,
      upsell: null,
    });
  } catch (err: any) {
    const msg = String(err?.code ?? err?.message ?? err);
    if (msg === "UNAUTHENTICATED") return Response.json({ error: "Unauthorized" }, { status: 401 });
    if (msg === "FORBIDDEN_NOT_ACTIVE") return Response.json({ error: "Forbidden" }, { status: 403 });
    return Response.json({ error: "Server error", message: msg }, { status: 500 });
  }
}