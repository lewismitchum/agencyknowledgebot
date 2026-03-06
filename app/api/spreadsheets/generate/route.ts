// app/api/spreadsheets/generate/route.ts
import type { NextRequest } from "next/server";
import { getDb, type Db } from "@/lib/db";
import { ensureSchema } from "@/lib/schema";
import { requireActiveMember } from "@/lib/authz";
import { getAgencyPlan } from "@/lib/enforcement";
import { normalizePlan, requireFeature } from "@/lib/plans";
import { openai } from "@/lib/openai";

export const runtime = "nodejs";

const FALLBACK = "I don’t have that information in the docs yet.";

type GenerateBody = {
  bot_id?: string;
  prompt?: string;
  columns?: string[];
  max_rows?: number;
};

type OutputColumn = {
  key: string;
  label: string;
  type: string;
};

function clampString(s: string, max: number) {
  const t = String(s ?? "");
  return t.length > max ? t.slice(0, max) : t;
}

function safeJsonParse(s: string): any | null {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function extractJsonFromText(text: string): any | null {
  const t = String(text || "").trim();
  if (!t) return null;

  const raw = safeJsonParse(t);
  if (raw) return raw;

  const m = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (m?.[1]) {
    const inner = safeJsonParse(m[1].trim());
    if (inner) return inner;
  }

  const arrayMatch = t.match(/\[[\s\S]*\]/);
  if (arrayMatch?.[0]) {
    const inner = safeJsonParse(arrayMatch[0]);
    if (inner) return inner;
  }

  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start >= 0 && end > start) {
    const inner = safeJsonParse(t.slice(start, end + 1));
    if (inner) return inner;
  }

  return null;
}

function responseHasFileSearchEvidence(resp: any): boolean {
  try {
    const s = JSON.stringify(resp ?? {});
    return s.includes("file_search") || s.includes("vector_store") || s.includes("citations") || s.includes("citation");
  } catch {
    return false;
  }
}

function toCsv(columns: string[], rows: string[][]) {
  const esc = (v: any) => {
    const s = v === null || v === undefined ? "" : String(v);
    if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };

  const header = columns.map(esc).join(",");
  const lines = (rows || []).map((r) => (columns || []).map((_, i) => esc(r?.[i] ?? "")).join(","));
  return [header, ...lines].join("\n");
}

function makeId(prefix: string) {
  const uuid =
    globalThis.crypto && "randomUUID" in globalThis.crypto
      ? (globalThis.crypto as any).randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}_${uuid}`;
}

async function getFallbackBotId(db: Db, agencyId: string, userId: string) {
  const agencyBot = (await db.get(
    `SELECT id
     FROM bots
     WHERE agency_id = ? AND owner_user_id IS NULL
     ORDER BY created_at DESC
     LIMIT 1`,
    agencyId
  )) as { id: string } | undefined;

  if (agencyBot?.id) return agencyBot.id;

  const userBot = (await db.get(
    `SELECT id
     FROM bots
     WHERE agency_id = ? AND owner_user_id = ?
     ORDER BY created_at DESC
     LIMIT 1`,
    agencyId,
    userId
  )) as { id: string } | undefined;

  return userBot?.id ?? null;
}

function normalizeColumnKey(input: string) {
  return String(input || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
}

function normalizeColumns(columnsRaw: any[], requestedCols: string[]) {
  const requested = requestedCols
    .map((c) => normalizeColumnKey(c))
    .filter(Boolean)
    .slice(0, 30);

  if (requested.length) {
    return requested.map((key) => ({
      key,
      label: key,
      type: "text",
    })) as OutputColumn[];
  }

  const normalized = (Array.isArray(columnsRaw) ? columnsRaw : [])
    .map((c: any) => {
      if (typeof c === "string") {
        const key = normalizeColumnKey(c);
        if (!key) return null;
        return { key, label: String(c).trim() || key, type: "text" };
      }

      const rawKey = String(c?.key ?? c?.label ?? "").trim();
      const key = normalizeColumnKey(rawKey);
      if (!key) return null;

      const label = String(c?.label ?? rawKey ?? key).trim() || key;
      const type = String(c?.type ?? "text").trim() || "text";
      return { key, label, type };
    })
    .filter(Boolean) as OutputColumn[];

  const deduped: OutputColumn[] = [];
  const seen = new Set<string>();

  for (const col of normalized) {
    if (seen.has(col.key)) continue;
    seen.add(col.key);
    deduped.push(col);
    if (deduped.length >= 30) break;
  }

  return deduped;
}

function extractRowsCandidate(parsed: any): any[] {
  if (Array.isArray(parsed?.rows)) return parsed.rows;
  if (Array.isArray(parsed?.data)) return parsed.data;
  if (Array.isArray(parsed?.items)) return parsed.items;
  if (Array.isArray(parsed?.table?.rows)) return parsed.table.rows;
  if (Array.isArray(parsed)) return parsed;
  return [];
}

function rowsToObjects(rowsRaw: any[], outputColumns: OutputColumn[], maxRows: number) {
  const colKeys = outputColumns.map((c) => c.key);

  const rows = (Array.isArray(rowsRaw) ? rowsRaw : []).slice(0, maxRows);

  return rows
    .map((row: any) => {
      if (Array.isArray(row)) {
        const obj: Record<string, string> = {};
        for (let i = 0; i < colKeys.length; i++) {
          obj[colKeys[i]] = row?.[i] == null ? "" : String(row[i]);
        }
        return obj;
      }

      if (row && typeof row === "object") {
        const normalizedRow: Record<string, string> = {};

        for (const key of colKeys) {
          if (row[key] != null) {
            normalizedRow[key] = String(row[key]);
            continue;
          }

          const matchingEntry = Object.entries(row).find(([rawKey]) => normalizeColumnKey(rawKey) === key);
          normalizedRow[key] = matchingEntry?.[1] == null ? "" : String(matchingEntry[1]);
        }

        return normalizedRow;
      }

      return null;
    })
    .filter(Boolean) as Array<Record<string, string>>;
}

export async function OPTIONS() {
  return new Response(null, { status: 204 });
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireActiveMember(req);
    const db: Db = await getDb();
    await ensureSchema(db);

    const plan = await getAgencyPlan(db, ctx.agencyId, ctx.plan);
    const planKey = normalizePlan(plan);

    const gate = requireFeature(planKey, "spreadsheets");
    if (!gate.ok) return Response.json(gate.body, { status: gate.status });

    const body = (await req.json().catch(() => null)) as GenerateBody | null;

    let botId = clampString(body?.bot_id ?? "", 200).trim();
    const userPrompt = clampString(body?.prompt ?? "", 4000).trim();

    const maxRowsRaw = Number(body?.max_rows);
    const maxRows = Number.isFinite(maxRowsRaw) ? Math.max(1, Math.min(500, Math.floor(maxRowsRaw))) : 200;

    const requestedCols = Array.isArray(body?.columns)
      ? body.columns.map((s) => normalizeColumnKey(String(s || ""))).filter(Boolean).slice(0, 40)
      : [];

    if (!userPrompt) {
      return Response.json({ ok: false, error: "MISSING_PROMPT" }, { status: 400 });
    }

    if (!botId) {
      const fallback = await getFallbackBotId(db, ctx.agencyId, ctx.userId);
      if (!fallback) return Response.json({ ok: false, error: "NO_BOTS" }, { status: 404 });
      botId = fallback;
    }

    const bot = (await db.get(
      `SELECT id, agency_id, owner_user_id, vector_store_id, name
       FROM bots
       WHERE id = ? AND agency_id = ?
       LIMIT 1`,
      botId,
      ctx.agencyId
    )) as
      | { id: string; agency_id: string; owner_user_id: string | null; vector_store_id: string | null; name?: string | null }
      | undefined;

    if (!bot?.id) {
      return Response.json({ ok: false, error: "BOT_NOT_FOUND" }, { status: 404 });
    }

    if (bot.owner_user_id && bot.owner_user_id !== ctx.userId) {
      return Response.json({ ok: false, error: "FORBIDDEN_BOT_ACCESS" }, { status: 403 });
    }

    const vectorStoreId = String(bot.vector_store_id ?? "").trim();
    if (!vectorStoreId) {
      return Response.json(
        { ok: false, error: "MISSING_VECTOR_STORE", message: "Bot has no vector store. Repair it in Bots first." },
        { status: 409 }
      );
    }

    const system = `
You are Louis.Ai. You generate spreadsheets ONLY from document evidence found via file_search.
You MUST return STRICT JSON ONLY (no markdown, no commentary).

Return exactly this JSON shape:
{
  "insufficient_evidence": boolean,
  "title": string,
  "columns": [{"key": string, "label": string, "type": "text"|"number"|"date"|"currency"|"boolean"}],
  "rows": [ { "<column.key>": <value>, ... } ],
  "notes": string
}

Rules:
- columns.length must be 1..30
- rows.length must be 0..${maxRows}
- Keys must be snake_case, stable
- Do NOT invent facts. If docs don't support values, set insufficient_evidence=true and return empty rows.
- Every row must include values for the requested/generated columns.
- If the user provided required columns, you MUST use them as keys in that order.
- Return multiple rows whenever the docs support multiple records. Do not return only headers unless there is truly no evidence.
`.trim();

    const requiredColsLine = requestedCols.length
      ? `\nRequired columns (use these exact keys in this order): ${requestedCols.join(", ")}\n`
      : "\n";

    const prompt = `
Generate a spreadsheet from our documents.

User request:
${userPrompt}
${requiredColsLine}
`.trim();

    let resp: any;
    try {
      resp = await openai.responses.create({
        model: "gpt-4.1-mini",
        input: [
          { role: "system", content: system },
          { role: "user", content: prompt },
        ],
        tools: [{ type: "file_search", vector_store_ids: [vectorStoreId] }],
      });
    } catch (e: any) {
      const msg = String(e?.message ?? e);
      const low = msg.toLowerCase();

      if (low.includes("quota") || low.includes("billing")) {
        return Response.json(
          { ok: false, error: "OPENAI_QUOTA", message: "OpenAI billing/quota issue. Please check your OpenAI account." },
          { status: 402 }
        );
      }

      console.error("SPREADSHEETS_GENERATE_OPENAI_ERROR", e);
      return Response.json({ ok: false, error: "OPENAI_ERROR", message: msg }, { status: 500 });
    }

    const text =
      typeof (resp as any)?.output_text === "string" && (resp as any).output_text.trim().length > 0
        ? (resp as any).output_text.trim()
        : "";

    const parsed = extractJsonFromText(text);
    const hasEvidence = responseHasFileSearchEvidence(resp);

    if (!parsed || typeof parsed !== "object") {
      return Response.json(
        {
          ok: true,
          plan: planKey,
          bot_id: botId,
          fallback: true,
          insufficient_evidence: true,
          message: FALLBACK,
        },
        { status: 200 }
      );
    }

    const insufficient = Boolean((parsed as any)?.insufficient_evidence);

    if (!hasEvidence || insufficient) {
      return Response.json(
        {
          ok: true,
          plan: planKey,
          bot_id: botId,
          fallback: true,
          insufficient_evidence: true,
          message: FALLBACK,
        },
        { status: 200 }
      );
    }

    const title = clampString((parsed as any)?.title ?? "Spreadsheet", 120).trim() || "Spreadsheet";
    const notes = clampString((parsed as any)?.notes ?? "", 1200);

    const columnsRaw = Array.isArray((parsed as any)?.columns) ? (parsed as any).columns : [];
    const outputColumns = normalizeColumns(columnsRaw, requestedCols);

    if (outputColumns.length === 0) {
      return Response.json(
        {
          ok: true,
          plan: planKey,
          bot_id: botId,
          fallback: true,
          insufficient_evidence: true,
          message: FALLBACK,
        },
        { status: 200 }
      );
    }

    const rowsRaw = extractRowsCandidate(parsed);
    const rowsObj = rowsToObjects(rowsRaw, outputColumns, maxRows);

    const colLabels = outputColumns.map((c) => c.label);
    const colKeys = outputColumns.map((c) => c.key);
    const rowsArr: string[][] = rowsObj.map((r) => colKeys.map((k) => (r?.[k] == null ? "" : String(r[k]))));
    const csv = toCsv(colLabels, rowsArr);

    const proposalId = makeId("sgen");

    await db.run(
      `INSERT INTO spreadsheet_proposals
       (id, agency_id, user_id, created_by_user_id, bot_id, status, instruction, csv_snapshot, proposal_json, created_at)
       VALUES (?, ?, ?, ?, ?, 'proposed', ?, ?, ?, datetime('now'))`,
      proposalId,
      ctx.agencyId,
      ctx.userId,
      ctx.userId,
      botId,
      userPrompt || null,
      csv || null,
      JSON.stringify({
        title,
        columns: outputColumns,
        rows: rowsObj,
        notes,
        _display: {
          column_labels: colLabels,
          row_arrays: rowsArr,
        },
      })
    );

    return Response.json({
      ok: true,
      plan: planKey,
      bot_id: botId,
      proposal_id: proposalId,
      title,
      notes,
      columns: outputColumns,
      rows: rowsObj,
      table: {
        title,
        columns: colLabels,
        rows: rowsArr,
        notes,
      },
      csv,
    });
  } catch (err: any) {
    const msg = String(err?.code ?? err?.message ?? err);
    if (msg === "UNAUTHENTICATED") return Response.json({ error: "Unauthorized" }, { status: 401 });
    if (msg === "FORBIDDEN_NOT_ACTIVE") return Response.json({ error: "Forbidden" }, { status: 403 });

    console.error("SPREADSHEETS_GENERATE_ERROR", err);
    return Response.json({ error: "Server error", message: msg }, { status: 500 });
  }
}