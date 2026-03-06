// app/api/spreadsheets/history/[proposalId]/route.ts
import type { NextRequest } from "next/server";
import { getDb, type Db } from "@/lib/db";
import { requireActiveMember } from "@/lib/authz";
import { ensureSchema } from "@/lib/schema";
import { getAgencyPlan } from "@/lib/enforcement";
import { normalizePlan, requireFeature } from "@/lib/plans";

export const runtime = "nodejs";

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

function normalizeDetailProposal(proposal: any) {
  if (!proposal || typeof proposal !== "object") {
    return {
      title: "Spreadsheet proposal",
      notes: "",
      source: "unknown" as const,
      columns: [] as string[],
      rows: [] as string[][],
      updates: [] as any[],
    };
  }

  const source = pickSource(proposal);
  const title = String(proposal?.title ?? "").trim() || "Spreadsheet proposal";
  const notes = String(proposal?.notes ?? "").trim();

  if (Array.isArray(proposal?.updates)) {
    const updates = proposal.updates
      .map((u: any) => ({
        row: Number(u?.row),
        col: String(u?.col ?? ""),
        old: u?.old == null ? null : String(u.old),
        new: String(u?.new ?? ""),
        reason: String(u?.reason ?? ""),
      }))
      .filter((u: any) => Number.isFinite(u.row) && u.row >= 1 && u.col && u.new);

    return {
      title,
      notes,
      source,
      columns: [] as string[],
      rows: [] as string[][],
      updates,
    };
  }

  let columns: string[] = [];
  let rows: string[][] = [];

  if (Array.isArray(proposal?.columns) && Array.isArray(proposal?.rows)) {
    if (proposal.columns.length > 0 && typeof proposal.columns[0] === "string") {
      columns = proposal.columns.map((c: any) => String(c ?? ""));
      rows = Array.isArray(proposal.rows)
        ? proposal.rows.map((r: any) =>
            Array.isArray(r) ? r.map((cell: any) => String(cell ?? "")) : []
          )
        : [];
    } else {
      const rawColumns = Array.isArray(proposal.columns) ? proposal.columns : [];
      const rawRows = Array.isArray(proposal.rows) ? proposal.rows : [];
      const normalizedColumns = rawColumns
        .map((c: any) => ({
          key: String(c?.key ?? "").trim(),
          label: String(c?.label ?? c?.key ?? "").trim(),
        }))
        .filter((c: any) => c.key);

      columns = normalizedColumns.map((c: any) => c.label || c.key);
      rows = rawRows.map((r: any) =>
        normalizedColumns.map((c: any) => (r?.[c.key] == null ? "" : String(r[c.key])))
      );
    }
  } else if (Array.isArray(proposal?._display?.column_labels) && Array.isArray(proposal?._display?.row_arrays)) {
    columns = proposal._display.column_labels.map((c: any) => String(c ?? ""));
    rows = proposal._display.row_arrays.map((r: any) =>
      Array.isArray(r) ? r.map((cell: any) => String(cell ?? "")) : []
    );
  } else if (Array.isArray(proposal?._raw?.columns) && Array.isArray(proposal?._raw?.rows)) {
    const rawColumns = proposal._raw.columns
      .map((c: any) => ({
        key: String(c?.key ?? "").trim(),
        label: String(c?.label ?? c?.key ?? "").trim(),
      }))
      .filter((c: any) => c.key);

    columns = rawColumns.map((c: any) => c.label || c.key);
    rows = proposal._raw.rows.map((r: any) =>
      rawColumns.map((c: any) => (r?.[c.key] == null ? "" : String(r[c.key])))
    );
  }

  return {
    title,
    notes,
    source,
    columns,
    rows,
    updates: [] as any[],
  };
}

export async function OPTIONS() {
  return new Response(null, { status: 204 });
}

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ proposalId: string }> }
) {
  try {
    const ctx = await requireActiveMember(req);
    const db: Db = await getDb();
    await ensureSchema(db);

    const plan = await getAgencyPlan(db, ctx.agencyId, ctx.plan);
    const planKey = normalizePlan(plan);

    const gate = requireFeature(planKey, "spreadsheets");
    if (!gate.ok) return Response.json(gate.body, { status: gate.status });

    const { proposalId } = await context.params;
    const id = String(proposalId ?? "").trim();

    if (!id) {
      return Response.json({ ok: false, error: "MISSING_PROPOSAL_ID" }, { status: 400 });
    }

    const proposalRow = (await db.get(
      `SELECT
         p.id,
         p.bot_id,
         p.status,
         p.instruction,
         p.csv_snapshot,
         p.proposal_json,
         p.created_at,
         p.applied_at,
         p.applied_by_user_id,
         b.name AS bot_name
       FROM spreadsheet_proposals p
       LEFT JOIN bots b
         ON b.id = p.bot_id
        AND b.agency_id = p.agency_id
       WHERE p.id = ?
         AND p.agency_id = ?
       LIMIT 1`,
      id,
      ctx.agencyId
    )) as
      | {
          id: string;
          bot_id?: string | null;
          status?: string | null;
          instruction?: string | null;
          csv_snapshot?: string | null;
          proposal_json?: string | null;
          created_at?: string | null;
          applied_at?: string | null;
          applied_by_user_id?: string | null;
          bot_name?: string | null;
        }
      | undefined;

    if (!proposalRow?.id) {
      return Response.json({ ok: false, error: "PROPOSAL_NOT_FOUND" }, { status: 404 });
    }

    const parsedProposal = safeJsonParse(proposalRow.proposal_json);
    const normalized = normalizeDetailProposal(parsedProposal);

    return Response.json({
      ok: true,
      plan: planKey,
      proposal: {
        id: proposalRow.id,
        status: String(proposalRow.status ?? "proposed"),
        instruction: String(proposalRow.instruction ?? ""),
        bot_id: proposalRow.bot_id ? String(proposalRow.bot_id) : null,
        bot_name: proposalRow.bot_name ? String(proposalRow.bot_name) : null,
        created_at: proposalRow.created_at ? String(proposalRow.created_at) : null,
        applied_at: proposalRow.applied_at ? String(proposalRow.applied_at) : null,
        applied_by_user_id: proposalRow.applied_by_user_id ? String(proposalRow.applied_by_user_id) : null,
        csv_snapshot: proposalRow.csv_snapshot ? String(proposalRow.csv_snapshot) : "",
        title: normalized.title,
        notes: normalized.notes,
        source: normalized.source,
        columns: normalized.columns,
        rows: normalized.rows,
        updates: normalized.updates,
        row_count: normalized.rows.length,
        column_count: normalized.columns.length,
      },
    });
  } catch (err: any) {
    const msg = String(err?.code ?? err?.message ?? err);
    if (msg === "UNAUTHENTICATED") return Response.json({ error: "Unauthorized" }, { status: 401 });
    if (msg === "FORBIDDEN_NOT_ACTIVE") return Response.json({ error: "Forbidden" }, { status: 403 });

    console.error("SPREADSHEETS_HISTORY_DETAIL_ERROR", err);
    return Response.json({ error: "Server error", message: msg }, { status: 500 });
  }
}