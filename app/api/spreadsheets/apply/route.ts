// app/api/spreadsheets/apply/route.ts
import type { NextRequest } from "next/server";
import { getDb, type Db } from "@/lib/db";
import { requireOwnerOrAdmin } from "@/lib/authz";
import { ensureSchema } from "@/lib/schema";
import { getAgencyPlan } from "@/lib/enforcement";
import { normalizePlan, requireFeature } from "@/lib/plans";
import {
  writeProposalToGoogleSheet,
  type LinkedSheetTarget,
  type SheetWritePlan,
} from "@/lib/google-sheets";

export const runtime = "nodejs";

type ApplyBody = {
  proposal_id?: string;
  action?: "APPLY" | "REJECT";
  note?: string;
};

type ProposalRow = {
  id?: string;
  status?: string | null;
  proposal_json?: string | null;
  bot_id?: string | null;
  instruction?: string | null;
  csv_snapshot?: string | null;
};

type SheetLinkRow = {
  proposal_id?: string | null;
  spreadsheet_id?: string | null;
  spreadsheet_name?: string | null;
  sheet_name?: string | null;
  range_a1?: string | null;
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

function safeJsonParse(s: string): any | null {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function normalizeTableProposal(parsed: any): { title: string; columns: string[]; rows: string[][] } | null {
  if (!parsed || typeof parsed !== "object") return null;

  const title = clampString(parsed?.title ?? "Spreadsheet", 120).trim() || "Spreadsheet";

  if (Array.isArray(parsed?.columns) && Array.isArray(parsed?.rows)) {
    if (parsed.columns.length > 0 && typeof parsed.columns[0] === "string") {
      const columns = parsed.columns.map((c: any) => String(c ?? "").trim()).filter(Boolean).slice(0, 200);
      const rows = parsed.rows
        .map((r: any) =>
          Array.isArray(r) ? r.map((cell: any) => String(cell ?? "")).slice(0, columns.length) : null
        )
        .filter(Boolean)
        .slice(0, 10000) as string[][];

      if (!columns.length) return null;
      return { title, columns, rows };
    }

    const normalizedColumns = parsed.columns
      .map((c: any) => ({
        key: String(c?.key ?? "").trim(),
        label: String(c?.label ?? c?.key ?? "").trim(),
      }))
      .filter((c: any) => c.key)
      .slice(0, 200);

    const columns = normalizedColumns.map((c: any) => c.label || c.key);
    if (!columns.length) return null;

    const rows = (Array.isArray(parsed.rows) ? parsed.rows : [])
      .map((r: any) =>
        normalizedColumns.map((c: any) => (r?.[c.key] == null ? "" : String(r[c.key])))
      )
      .slice(0, 10000);

    return { title, columns, rows };
  }

  if (Array.isArray(parsed?._display?.column_labels) && Array.isArray(parsed?._display?.row_arrays)) {
    const columns = parsed._display.column_labels
      .map((c: any) => String(c ?? "").trim())
      .filter(Boolean)
      .slice(0, 200);

    if (!columns.length) return null;

    const rows = parsed._display.row_arrays
      .map((r: any) =>
        Array.isArray(r) ? r.map((cell: any) => String(cell ?? "")).slice(0, columns.length) : null
      )
      .filter(Boolean)
      .slice(0, 10000) as string[][];

    return { title, columns, rows };
  }

  if (Array.isArray(parsed?._raw?.columns) && Array.isArray(parsed?._raw?.rows)) {
    const normalizedColumns = parsed._raw.columns
      .map((c: any) => ({
        key: String(c?.key ?? "").trim(),
        label: String(c?.label ?? c?.key ?? "").trim(),
      }))
      .filter((c: any) => c.key)
      .slice(0, 200);

    const columns = normalizedColumns.map((c: any) => c.label || c.key);
    if (!columns.length) return null;

    const rows = parsed._raw.rows
      .map((r: any) =>
        normalizedColumns.map((c: any) => (r?.[c.key] == null ? "" : String(r[c.key])))
      )
      .slice(0, 10000);

    return { title, columns, rows };
  }

  return null;
}

function normalizeUpdateProposal(parsed: any, csvSnapshot: string) {
  if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed?.updates)) return null;

  const updates = parsed.updates
    .map((u: any) => ({
      row: Number(u?.row),
      col: String(u?.col ?? "").trim(),
      old: u?.old == null ? null : String(u.old),
      new: String(u?.new ?? "").trim(),
      reason: String(u?.reason ?? "").trim(),
    }))
    .filter((u: any) => Number.isFinite(u.row) && u.row >= 1 && u.col && u.new)
    .slice(0, 200);

  if (!updates.length) return null;

  return {
    updates,
    csv_snapshot: csvSnapshot || "",
  };
}

function buildWritePlan(parsedProposal: any, csvSnapshot: string): SheetWritePlan | null {
  const updatePlan = normalizeUpdateProposal(parsedProposal, csvSnapshot);
  if (updatePlan) {
    return {
      kind: "updates",
      updates: updatePlan.updates,
      csv_snapshot: updatePlan.csv_snapshot,
    };
  }

  const tablePlan = normalizeTableProposal(parsedProposal);
  if (tablePlan) {
    return {
      kind: "table",
      title: tablePlan.title,
      columns: tablePlan.columns,
      rows: tablePlan.rows,
    };
  }

  return null;
}

async function getLinkedSheet(db: Db, agencyId: string, proposalId: string) {
  return (await db.get(
    `SELECT proposal_id, spreadsheet_id, spreadsheet_name, sheet_name, range_a1
     FROM spreadsheet_sheet_links
     WHERE agency_id = ? AND proposal_id = ?
     LIMIT 1`,
    agencyId,
    proposalId
  )) as SheetLinkRow | undefined;
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
    const action = String(body?.action ?? "APPLY").toUpperCase() as "APPLY" | "REJECT";
    const note = clampString(body?.note ?? "", 2000);

    if (!proposalId) {
      return Response.json({ ok: false, error: "MISSING_PROPOSAL_ID" }, { status: 400 });
    }

    if (action !== "APPLY" && action !== "REJECT") {
      return Response.json({ ok: false, error: "INVALID_ACTION" }, { status: 400 });
    }

    const row = (await db.get(
      `SELECT id, status, proposal_json, bot_id, instruction, csv_snapshot
       FROM spreadsheet_proposals
       WHERE id = ? AND agency_id = ?
       LIMIT 1`,
      proposalId,
      ctx.agencyId
    )) as ProposalRow | undefined;

    if (!row?.id) {
      return Response.json({ ok: false, error: "PROPOSAL_NOT_FOUND" }, { status: 404 });
    }

    const status = String(row.status ?? "proposed").toLowerCase();
    if (status !== "proposed") {
      return Response.json({ ok: false, error: "PROPOSAL_NOT_PENDING", status }, { status: 409 });
    }

    const parsedProposal = row.proposal_json ? safeJsonParse(row.proposal_json) : null;
    const auditId = makeId("saudit");

    if (action === "REJECT") {
      const details = {
        note: note || null,
        proposal: parsedProposal,
        bot_id: row.bot_id ?? null,
        instruction: row.instruction ?? null,
        csv_snapshot: row.csv_snapshot ?? null,
        write_status: "skipped_reject",
      };

      await db.run(
        `INSERT INTO spreadsheet_audit_log
         (id, agency_id, user_id, actor_user_id, proposal_id, action, details_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
        auditId,
        ctx.agencyId,
        ctx.userId,
        ctx.userId,
        proposalId,
        action,
        JSON.stringify(details)
      );

      await db.run(
        `UPDATE spreadsheet_proposals
         SET status = 'rejected', applied_at = datetime('now'), applied_by_user_id = ?
         WHERE id = ? AND agency_id = ?`,
        ctx.userId,
        proposalId,
        ctx.agencyId
      );

      return Response.json({
        ok: true,
        plan: planKey,
        proposal_id: proposalId,
        action,
        audit_id: auditId,
        message: "Proposal rejected and audit log recorded.",
      });
    }

    const link = await getLinkedSheet(db, ctx.agencyId, proposalId);
    if (!link?.spreadsheet_id || !link?.sheet_name) {
      return Response.json(
        {
          ok: false,
          error: "MISSING_LINKED_SHEET",
          message: "Link a Google Sheet to this proposal before applying it.",
        },
        { status: 400 }
      );
    }

    const writePlan = buildWritePlan(parsedProposal, String(row.csv_snapshot ?? ""));
    if (!writePlan) {
      return Response.json(
        {
          ok: false,
          error: "INVALID_PROPOSAL_PAYLOAD",
          message: "This proposal does not contain a valid table or update payload.",
        },
        { status: 400 }
      );
    }

    const linkedSheet: LinkedSheetTarget = {
      spreadsheetId: String(link.spreadsheet_id),
      spreadsheetName: link.spreadsheet_name ? String(link.spreadsheet_name) : null,
      sheetName: String(link.sheet_name),
      rangeA1: link.range_a1 ? String(link.range_a1) : null,
    };

    const auditDetailsBase = {
      note: note || null,
      proposal: parsedProposal,
      bot_id: row.bot_id ?? null,
      instruction: row.instruction ?? null,
      csv_snapshot: row.csv_snapshot ?? null,
      linked_sheet: {
        spreadsheet_id: linkedSheet.spreadsheetId,
        spreadsheet_name: linkedSheet.spreadsheetName,
        sheet_name: linkedSheet.sheetName,
        range_a1: linkedSheet.rangeA1,
      },
      write_plan: writePlan,
    };

    try {
      const writeResult = await writeProposalToGoogleSheet({
        target: linkedSheet,
        plan: writePlan,
      });

      await db.run(
        `INSERT INTO spreadsheet_audit_log
         (id, agency_id, user_id, actor_user_id, proposal_id, action, details_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
        auditId,
        ctx.agencyId,
        ctx.userId,
        ctx.userId,
        proposalId,
        action,
        JSON.stringify({
          ...auditDetailsBase,
          write_status: "success",
          write_result: writeResult,
        })
      );
    } catch (writeErr: any) {
      const writeMessage = String(writeErr?.message ?? writeErr);

      await db.run(
        `INSERT INTO spreadsheet_audit_log
         (id, agency_id, user_id, actor_user_id, proposal_id, action, details_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
        auditId,
        ctx.agencyId,
        ctx.userId,
        ctx.userId,
        proposalId,
        action,
        JSON.stringify({
          ...auditDetailsBase,
          write_status: "failed",
          write_error: writeMessage,
        })
      );

      return Response.json(
        {
          ok: false,
          error: "GOOGLE_SHEETS_WRITE_FAILED",
          message: writeMessage,
          audit_id: auditId,
        },
        { status: 409 }
      );
    }

    await db.run(
      `UPDATE spreadsheet_proposals
       SET status = 'applied', applied_at = datetime('now'), applied_by_user_id = ?
       WHERE id = ? AND agency_id = ?`,
      ctx.userId,
      proposalId,
      ctx.agencyId
    );

    return Response.json({
      ok: true,
      plan: planKey,
      proposal_id: proposalId,
      action,
      audit_id: auditId,
      message: "Proposal applied, sheet updated, and audit log recorded.",
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