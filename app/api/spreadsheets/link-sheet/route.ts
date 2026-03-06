// app/api/spreadsheets/link-sheet/route.ts
import type { NextRequest } from "next/server";
import { getDb, type Db } from "@/lib/db";
import { requireActiveMember } from "@/lib/authz";
import { ensureSchema } from "@/lib/schema";
import { getAgencyPlan } from "@/lib/enforcement";
import { normalizePlan, requireFeature } from "@/lib/plans";

export const runtime = "nodejs";

type LinkSheetBody = {
  proposal_id?: string;
  spreadsheet_id?: string;
  spreadsheet_name?: string;
  sheet_name?: string;
  range_a1?: string;
};

function clampString(s: string, max: number) {
  const t = String(s ?? "");
  return t.length > max ? t.slice(0, max) : t;
}

async function ensureSpreadsheetSheetLinksTable(db: Db) {
  await db.run(`
    CREATE TABLE IF NOT EXISTS spreadsheet_sheet_links (
      id TEXT PRIMARY KEY,
      agency_id TEXT NOT NULL,
      proposal_id TEXT NOT NULL,
      spreadsheet_id TEXT NOT NULL,
      spreadsheet_name TEXT,
      sheet_name TEXT NOT NULL,
      range_a1 TEXT,
      created_by_user_id TEXT NOT NULL,
      updated_by_user_id TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  await db.run(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_spreadsheet_sheet_links_agency_proposal
     ON spreadsheet_sheet_links (agency_id, proposal_id)`
  );

  await db.run(
    `CREATE INDEX IF NOT EXISTS idx_spreadsheet_sheet_links_agency_sheet
     ON spreadsheet_sheet_links (agency_id, spreadsheet_id, sheet_name)`
  );
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

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireActiveMember(req);
    const db: Db = await getDb();
    await ensureSchema(db);
    await ensureSpreadsheetSheetLinksTable(db);

    const plan = await getAgencyPlan(db, ctx.agencyId, ctx.plan);
    const planKey = normalizePlan(plan);

    const gate = requireFeature(planKey, "spreadsheets");
    if (!gate.ok) return Response.json(gate.body, { status: gate.status });

    const url = new URL(req.url);
    const proposalId = clampString(url.searchParams.get("proposal_id") ?? "", 200).trim();

    if (!proposalId) {
      return Response.json({ ok: false, error: "MISSING_PROPOSAL_ID" }, { status: 400 });
    }

    const proposal = (await db.get(
      `SELECT id, agency_id
       FROM spreadsheet_proposals
       WHERE id = ? AND agency_id = ?
       LIMIT 1`,
      proposalId,
      ctx.agencyId
    )) as { id?: string; agency_id?: string } | undefined;

    if (!proposal?.id) {
      return Response.json({ ok: false, error: "PROPOSAL_NOT_FOUND" }, { status: 404 });
    }

    const link = (await db.get(
      `SELECT
         proposal_id,
         spreadsheet_id,
         spreadsheet_name,
         sheet_name,
         range_a1,
         created_at,
         updated_at
       FROM spreadsheet_sheet_links
       WHERE agency_id = ? AND proposal_id = ?
       LIMIT 1`,
      ctx.agencyId,
      proposalId
    )) as
      | {
          proposal_id?: string;
          spreadsheet_id?: string;
          spreadsheet_name?: string | null;
          sheet_name?: string | null;
          range_a1?: string | null;
          created_at?: string | null;
          updated_at?: string | null;
        }
      | undefined;

    return Response.json({
      ok: true,
      plan: planKey,
      link: link
        ? {
            proposal_id: String(link.proposal_id ?? proposalId),
            spreadsheet_id: String(link.spreadsheet_id ?? ""),
            spreadsheet_name: link.spreadsheet_name ? String(link.spreadsheet_name) : null,
            sheet_name: link.sheet_name ? String(link.sheet_name) : null,
            range_a1: link.range_a1 ? String(link.range_a1) : null,
            created_at: link.created_at ? String(link.created_at) : null,
            updated_at: link.updated_at ? String(link.updated_at) : null,
          }
        : null,
    });
  } catch (err: any) {
    const msg = String(err?.code ?? err?.message ?? err);
    if (msg === "UNAUTHENTICATED") return Response.json({ error: "Unauthorized" }, { status: 401 });
    if (msg === "FORBIDDEN_NOT_ACTIVE") return Response.json({ error: "Forbidden" }, { status: 403 });

    console.error("SPREADSHEETS_LINK_SHEET_GET_ERROR", err);
    return Response.json({ error: "Server error", message: msg }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireActiveMember(req);
    const db: Db = await getDb();
    await ensureSchema(db);
    await ensureSpreadsheetSheetLinksTable(db);

    const plan = await getAgencyPlan(db, ctx.agencyId, ctx.plan);
    const planKey = normalizePlan(plan);

    const gate = requireFeature(planKey, "spreadsheets");
    if (!gate.ok) return Response.json(gate.body, { status: gate.status });

    const body = (await req.json().catch(() => null)) as LinkSheetBody | null;

    const proposalId = clampString(body?.proposal_id ?? "", 200).trim();
    const spreadsheetId = clampString(body?.spreadsheet_id ?? "", 500).trim();
    const spreadsheetName = clampString(body?.spreadsheet_name ?? "", 300).trim();
    const sheetName = clampString(body?.sheet_name ?? "", 120).trim();
    const rangeA1 = clampString(body?.range_a1 ?? "", 120).trim();

    if (!proposalId) {
      return Response.json({ ok: false, error: "MISSING_PROPOSAL_ID" }, { status: 400 });
    }
    if (!spreadsheetId) {
      return Response.json({ ok: false, error: "MISSING_SPREADSHEET_ID" }, { status: 400 });
    }
    if (!sheetName) {
      return Response.json({ ok: false, error: "MISSING_SHEET_NAME" }, { status: 400 });
    }

    const proposal = (await db.get(
      `SELECT id, agency_id, created_by_user_id, user_id
       FROM spreadsheet_proposals
       WHERE id = ? AND agency_id = ?
       LIMIT 1`,
      proposalId,
      ctx.agencyId
    )) as
      | {
          id?: string;
          agency_id?: string;
          created_by_user_id?: string | null;
          user_id?: string | null;
        }
      | undefined;

    if (!proposal?.id) {
      return Response.json({ ok: false, error: "PROPOSAL_NOT_FOUND" }, { status: 404 });
    }

    const existing = (await db.get(
      `SELECT id
       FROM spreadsheet_sheet_links
       WHERE agency_id = ? AND proposal_id = ?
       LIMIT 1`,
      ctx.agencyId,
      proposalId
    )) as { id?: string } | undefined;

    if (existing?.id) {
      await db.run(
        `UPDATE spreadsheet_sheet_links
         SET spreadsheet_id = ?,
             spreadsheet_name = ?,
             sheet_name = ?,
             range_a1 = ?,
             updated_by_user_id = ?,
             updated_at = datetime('now')
         WHERE id = ? AND agency_id = ?`,
        spreadsheetId,
        spreadsheetName || null,
        sheetName,
        rangeA1 || null,
        ctx.userId,
        existing.id,
        ctx.agencyId
      );
    } else {
      const id = makeId("sslink");
      await db.run(
        `INSERT INTO spreadsheet_sheet_links
         (id, agency_id, proposal_id, spreadsheet_id, spreadsheet_name, sheet_name, range_a1, created_by_user_id, updated_by_user_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
        id,
        ctx.agencyId,
        proposalId,
        spreadsheetId,
        spreadsheetName || null,
        sheetName,
        rangeA1 || null,
        ctx.userId,
        ctx.userId
      );
    }

    return Response.json({
      ok: true,
      plan: planKey,
      link: {
        proposal_id: proposalId,
        spreadsheet_id: spreadsheetId,
        spreadsheet_name: spreadsheetName || null,
        sheet_name: sheetName,
        range_a1: rangeA1 || null,
      },
      message: "Sheet linked to proposal.",
    });
  } catch (err: any) {
    const msg = String(err?.code ?? err?.message ?? err);
    if (msg === "UNAUTHENTICATED") return Response.json({ error: "Unauthorized" }, { status: 401 });
    if (msg === "FORBIDDEN_NOT_ACTIVE") return Response.json({ error: "Forbidden" }, { status: 403 });

    console.error("SPREADSHEETS_LINK_SHEET_POST_ERROR", err);
    return Response.json({ error: "Server error", message: msg }, { status: 500 });
  }
}