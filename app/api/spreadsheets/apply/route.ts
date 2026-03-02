// app/api/spreadsheets/apply/route.ts
import type { NextRequest } from "next/server";
import { getDb, type Db } from "@/lib/db";
import { requireOwnerOrAdmin } from "@/lib/authz";
import { ensureSchema } from "@/lib/schema";
import { getAgencyPlan } from "@/lib/enforcement";
import { normalizePlan, requireFeature } from "@/lib/plans";

export const runtime = "nodejs";

type ApplyBody = {
  proposal_id?: string;
  action?: "APPLY" | "REJECT";
  note?: string;
};

function clampString(s: string, max: number) {
  const t = String(s ?? "");
  return t.length > max ? t.slice(0, max) : t;
}

function makeId(prefix: string) {
  const uuid =
    globalThis.crypto && "randomUUID" in globalThis.crypto
      ? (globalThis.crypto as any).randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}_${uuid}`;
}

export async function OPTIONS() {
  return new Response(null, { status: 204 });
}

export async function GET() {
  return Response.json({ error: "METHOD_NOT_ALLOWED" }, { status: 405 });
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireOwnerOrAdmin(req);
    const db: Db = await getDb();
    await ensureSchema(db);

    const plan = await getAgencyPlan(db, ctx.agencyId, ctx.plan);
    const planKey = normalizePlan(plan);

    const gate = requireFeature(planKey, "spreadsheets");
    if (!gate.ok) return Response.json(gate.body, { status: gate.status });

    const body = (await req.json().catch(() => null)) as ApplyBody | null;
    const proposalId = String(body?.proposal_id ?? "").trim();
    const action = (String(body?.action ?? "APPLY").toUpperCase() as "APPLY" | "REJECT") || "APPLY";
    const note = clampString(body?.note ?? "", 2000);

    if (!proposalId) return Response.json({ ok: false, error: "MISSING_PROPOSAL_ID" }, { status: 400 });
    if (action !== "APPLY" && action !== "REJECT") {
      return Response.json({ ok: false, error: "INVALID_ACTION" }, { status: 400 });
    }

    const row = (await db.get(
      `SELECT id, status, proposal_json
       FROM spreadsheet_proposals
       WHERE id = ? AND agency_id = ?
       LIMIT 1`,
      proposalId,
      ctx.agencyId
    )) as { id?: string; status?: string | null; proposal_json?: string | null } | undefined;

    if (!row?.id) return Response.json({ ok: false, error: "PROPOSAL_NOT_FOUND" }, { status: 404 });

    const status = String(row.status ?? "proposed").toLowerCase();
    if (status !== "proposed") {
      return Response.json(
        { ok: false, error: "PROPOSAL_NOT_PENDING", status },
        { status: 409 }
      );
    }

    const auditId = makeId("saudit");
    const details = {
      note: note || null,
      proposal: row.proposal_json ? JSON.parse(row.proposal_json) : null,
    };

    await db.run(
      `INSERT INTO spreadsheet_audit_log
       (id, agency_id, proposal_id, action, actor_user_id, details_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`,
      auditId,
      ctx.agencyId,
      proposalId,
      action,
      ctx.userId,
      JSON.stringify(details)
    );

    if (action === "APPLY") {
      await db.run(
        `UPDATE spreadsheet_proposals
         SET status = 'applied', applied_at = datetime('now'), applied_by_user_id = ?
         WHERE id = ? AND agency_id = ?`,
        ctx.userId,
        proposalId,
        ctx.agencyId
      );
    } else {
      await db.run(
        `UPDATE spreadsheet_proposals
         SET status = 'rejected', applied_at = datetime('now'), applied_by_user_id = ?
         WHERE id = ? AND agency_id = ?`,
        ctx.userId,
        proposalId,
        ctx.agencyId
      );
    }

    return Response.json({
      ok: true,
      plan: planKey,
      proposal_id: proposalId,
      action,
      audit_id: auditId,
    });
  } catch (err: any) {
    const msg = String(err?.code ?? err?.message ?? err);
    if (msg === "UNAUTHENTICATED") return Response.json({ error: "Unauthorized" }, { status: 401 });
    if (msg === "FORBIDDEN_NOT_ACTIVE") return Response.json({ error: "Forbidden" }, { status: 403 });
    if (msg === "FORBIDDEN_NOT_ADMIN_OR_OWNER") return Response.json({ error: "Forbidden" }, { status: 403 });

    console.error("SPREADSHEETS_APPLY_ERROR", err);
    return Response.json({ error: "Server error", message: msg }, { status: 500 });
  }
}