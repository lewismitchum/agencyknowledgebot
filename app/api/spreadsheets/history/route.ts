// app/api/spreadsheets/history/route.ts
import type { NextRequest } from "next/server";
import { getDb, type Db } from "@/lib/db";
import { requireActiveMember } from "@/lib/authz";
import { ensureSchema } from "@/lib/schema";
import { getAgencyPlan } from "@/lib/enforcement";
import { normalizePlan, requireFeature } from "@/lib/plans";

export const runtime = "nodejs";

function clampInt(n: unknown, fallback: number, min: number, max: number) {
  const v = Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(v)));
}

function safeJsonParse(s: string | null | undefined): any | null {
  if (!s) return null;
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function pickSource(proposal: any): "docs" | "csv" | "ai" | "unknown" {
  const source = String(proposal?.source ?? "").toLowerCase();
  if (source === "ai_generate" || source === "ai") return "ai";

  const hasUpdates = Array.isArray(proposal?.updates);
  if (hasUpdates) return "csv";

  const hasRows =
    Array.isArray(proposal?.rows) ||
    Array.isArray(proposal?._display?.row_arrays) ||
    Array.isArray(proposal?._raw?.rows);

  if (hasRows) return "docs";

  return "unknown";
}

function pickPreviewTitle(row: {
  instruction?: string | null;
  proposal_json?: string | null;
}) {
  const parsed = safeJsonParse(row.proposal_json);
  const title = String(parsed?.title ?? "").trim();
  if (title) return title;

  const instruction = String(row.instruction ?? "").trim();
  if (instruction) return instruction.slice(0, 120);

  return "Spreadsheet proposal";
}

function pickRowCount(proposal: any): number {
  if (Array.isArray(proposal?.rows)) return proposal.rows.length;
  if (Array.isArray(proposal?._display?.row_arrays)) return proposal._display.row_arrays.length;
  if (Array.isArray(proposal?._raw?.rows)) return proposal._raw.rows.length;
  return 0;
}

function pickColumnCount(proposal: any): number {
  if (Array.isArray(proposal?.columns)) return proposal.columns.length;
  if (Array.isArray(proposal?._display?.column_labels)) return proposal._display.column_labels.length;
  return 0;
}

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

    const gate = requireFeature(planKey, "spreadsheets");
    if (!gate.ok) return Response.json(gate.body, { status: gate.status });

    const url = new URL(req.url);
    const limit = clampInt(url.searchParams.get("limit"), 25, 1, 100);
    const statusFilter = String(url.searchParams.get("status") ?? "").trim().toLowerCase();

    const allowedStatuses = new Set(["proposed", "applied", "rejected"]);
    const hasStatusFilter = allowedStatuses.has(statusFilter);

    const rows = (hasStatusFilter
      ? await db.all(
          `SELECT
             id,
             bot_id,
             status,
             instruction,
             proposal_json,
             created_at,
             applied_at,
             applied_by_user_id
           FROM spreadsheet_proposals
           WHERE agency_id = ? AND status = ?
           ORDER BY datetime(created_at) DESC
           LIMIT ?`,
          ctx.agencyId,
          statusFilter,
          limit
        )
      : await db.all(
          `SELECT
             id,
             bot_id,
             status,
             instruction,
             proposal_json,
             created_at,
             applied_at,
             applied_by_user_id
           FROM spreadsheet_proposals
           WHERE agency_id = ?
           ORDER BY datetime(created_at) DESC
           LIMIT ?`,
          ctx.agencyId,
          limit
        )) as Array<{
      id: string;
      bot_id?: string | null;
      status?: string | null;
      instruction?: string | null;
      proposal_json?: string | null;
      created_at?: string | null;
      applied_at?: string | null;
      applied_by_user_id?: string | null;
    }>;

    const botIds = Array.from(
      new Set(
        rows
          .map((r) => String(r.bot_id ?? "").trim())
          .filter(Boolean)
      )
    );

    let botNameMap = new Map<string, string>();
    if (botIds.length > 0) {
      const placeholders = botIds.map(() => "?").join(",");
      const botRows = (await db.all(
        `SELECT id, name
         FROM bots
         WHERE agency_id = ? AND id IN (${placeholders})`,
        ctx.agencyId,
        ...botIds
      )) as Array<{ id: string; name?: string | null }>;

      botNameMap = new Map(botRows.map((b) => [String(b.id), String(b.name ?? "Bot")]));
    }

    const history = rows.map((row) => {
      const parsed = safeJsonParse(row.proposal_json);
      const source = pickSource(parsed);

      return {
        id: String(row.id),
        status: String(row.status ?? "proposed"),
        source,
        title: pickPreviewTitle(row),
        instruction: String(row.instruction ?? ""),
        bot_id: row.bot_id ? String(row.bot_id) : null,
        bot_name: row.bot_id ? botNameMap.get(String(row.bot_id)) ?? null : null,
        created_at: row.created_at ? String(row.created_at) : null,
        applied_at: row.applied_at ? String(row.applied_at) : null,
        applied_by_user_id: row.applied_by_user_id ? String(row.applied_by_user_id) : null,
        row_count: pickRowCount(parsed),
        column_count: pickColumnCount(parsed),
      };
    });

    return Response.json({
      ok: true,
      plan: planKey,
      history,
    });
  } catch (err: any) {
    const msg = String(err?.code ?? err?.message ?? err);
    if (msg === "UNAUTHENTICATED") return Response.json({ error: "Unauthorized" }, { status: 401 });
    if (msg === "FORBIDDEN_NOT_ACTIVE") return Response.json({ error: "Forbidden" }, { status: 403 });

    console.error("SPREADSHEETS_HISTORY_ERROR", err);
    return Response.json({ error: "Server error", message: msg }, { status: 500 });
  }
}