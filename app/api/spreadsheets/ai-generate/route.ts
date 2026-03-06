// app/api/spreadsheets/ai-generate/route.ts
import type { NextRequest } from "next/server";
import { getDb, type Db } from "@/lib/db";
import { ensureSchema } from "@/lib/schema";
import { requireActiveMember } from "@/lib/authz";
import { getAgencyPlan } from "@/lib/enforcement";
import { normalizePlan, requireFeature } from "@/lib/plans";
import { openai } from "@/lib/openai";

export const runtime = "nodejs";

type AiGenerateBody = {
  prompt?: string;
  columns?: string[];
  max_rows?: number;
};

type OutputColumn = {
  key: string;
  label: string;
  type: string;
};

type OutputSource = {
  title: string;
  url: string;
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

function normalizeColumnKey(input: string) {
  return String(input || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
}

function toCsv(columns: string[], rows: string[][]) {
  const esc = (v: any) => {
    const s = v == null ? "" : String(v);
    if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };

  const header = columns.map(esc).join(",");
  const body = rows.map((r) => columns.map((_, i) => esc(r?.[i] ?? "")).join(","));
  return [header, ...body].join("\n");
}

function makeId(prefix: string) {
  const uuid =
    globalThis.crypto && "randomUUID" in globalThis.crypto
      ? (globalThis.crypto as any).randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}_${uuid}`;
}

function normalizeColumns(columnsRaw: any[], requestedCols: string[]) {
  const requested = requestedCols
    .map((c) => normalizeColumnKey(c))
    .filter(Boolean)
    .slice(0, 20);

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
    if (deduped.length >= 20) break;
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

  return (Array.isArray(rowsRaw) ? rowsRaw : [])
    .slice(0, maxRows)
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

function extractWebSources(resp: any): OutputSource[] {
  const out: OutputSource[] = [];
  const seen = new Set<string>();

  function pushSource(title: any, url: any) {
    const cleanUrl = String(url ?? "").trim();
    if (!cleanUrl) return;
    if (seen.has(cleanUrl)) return;
    seen.add(cleanUrl);
    out.push({
      title: clampString(String(title ?? cleanUrl).trim() || cleanUrl, 300),
      url: clampString(cleanUrl, 2000),
    });
  }

  function walk(node: any) {
    if (!node) return;

    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }

    if (typeof node !== "object") return;

    if (node.type === "url_citation") {
      pushSource(node.title, node.url);
    }

    if (node.url && (node.title || node.url)) {
      pushSource(node.title, node.url);
    }

    if (Array.isArray(node.sources)) {
      for (const s of node.sources) {
        pushSource(s?.title, s?.url);
      }
    }

    for (const value of Object.values(node)) {
      if (value && typeof value === "object") walk(value);
    }
  }

  walk(resp);
  return out.slice(0, 50);
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

    const body = (await req.json().catch(() => null)) as AiGenerateBody | null;
    const prompt = clampString(body?.prompt ?? "", 4000).trim();

    if (!prompt) {
      return Response.json({ ok: false, error: "MISSING_PROMPT" }, { status: 400 });
    }

    const maxRowsRaw = Number(body?.max_rows);
    const maxRows = Number.isFinite(maxRowsRaw) ? Math.max(1, Math.min(200, Math.floor(maxRowsRaw))) : 100;

    const requestedCols = Array.isArray(body?.columns)
      ? body.columns.map((s) => normalizeColumnKey(String(s || ""))).filter(Boolean).slice(0, 20)
      : [];

    const system = `
You are Louis.Ai. Use WEB SEARCH to build a spreadsheet from real online sources.
Return STRICT JSON ONLY. No markdown. No commentary outside JSON.

Return exactly this shape:
{
  "insufficient_evidence": boolean,
  "title": string,
  "columns": [{"key": string, "label": string, "type": "text"|"number"|"date"|"currency"|"boolean"}],
  "rows": [ { "<column.key>": <value>, ... } ],
  "notes": string,
  "sources": [{"title": string, "url": string}]
}

Rules:
- You MUST use web search before answering.
- Do NOT invent rows, sample rows, placeholder rows, or examples.
- If the web does not support the requested spreadsheet clearly enough, set insufficient_evidence=true and return empty rows.
- columns.length must be 1..20
- rows.length must be 0..${maxRows}
- Use snake_case keys
- Keep cells concise
- Include only rows supported by web evidence
- sources must contain the URLs actually used
- If the user supplied required columns, use them in that exact order as keys
`.trim();

    const requiredColsLine = requestedCols.length
      ? `Required columns (use these exact keys in this order): ${requestedCols.join(", ")}`
      : "Choose sensible columns based on the prompt and the available web evidence.";

    const userInput = `
Build a spreadsheet from web sources.

User request:
${prompt}

${requiredColsLine}
`.trim();

    let resp: any;
    try {
      resp = await openai.responses.create({
        model: "gpt-4.1-mini",
        input: [
          { role: "system", content: system },
          { role: "user", content: userInput },
        ],
        tools: [{ type: "web_search" }],
        include: ["web_search_call.action.sources"],
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

      console.error("SPREADSHEETS_AI_GENERATE_OPENAI_ERROR", e);
      return Response.json({ ok: false, error: "OPENAI_ERROR", message: msg }, { status: 500 });
    }

    const text =
      typeof resp?.output_text === "string" && resp.output_text.trim().length > 0
        ? resp.output_text.trim()
        : "";

    const parsed = extractJsonFromText(text);
    if (!parsed || typeof parsed !== "object") {
      return Response.json({ ok: false, error: "INVALID_MODEL_OUTPUT" }, { status: 500 });
    }

    const rawColumns = Array.isArray(parsed?.columns) ? parsed.columns : [];
    const normalizedColumns = normalizeColumns(rawColumns, requestedCols);

    if (normalizedColumns.length === 0) {
      return Response.json({ ok: false, error: "NO_COLUMNS" }, { status: 500 });
    }

    const rawRows = extractRowsCandidate(parsed);
    const rowsObj = rowsToObjects(rawRows, normalizedColumns, maxRows);

    const modelSources = Array.isArray(parsed?.sources) ? parsed.sources : [];
    const toolSources = extractWebSources(resp);

    const mergedSources: OutputSource[] = [];
    const seen = new Set<string>();

    for (const source of [...modelSources, ...toolSources]) {
      const title = clampString(String((source as any)?.title ?? "").trim(), 300);
      const url = clampString(String((source as any)?.url ?? "").trim(), 2000);
      if (!url || seen.has(url)) continue;
      seen.add(url);
      mergedSources.push({ title: title || url, url });
      if (mergedSources.length >= 50) break;
    }

    const insufficient = Boolean(parsed?.insufficient_evidence) || mergedSources.length === 0;

    const title = clampString(parsed?.title ?? "Web Spreadsheet", 120).trim() || "Web Spreadsheet";
    const notes = clampString(
      parsed?.notes ??
        (insufficient
          ? "Not enough reliable web evidence was found to populate rows."
          : `Built from web sources. Sources used: ${mergedSources.length}.`),
      1200
    );

    const colKeys = normalizedColumns.map((c) => c.key);
    const colLabels = normalizedColumns.map((c) => c.label || c.key);

    const finalRowsObj = insufficient ? [] : rowsObj;
    const rowsArr = finalRowsObj.map((r) => colKeys.map((k) => (r?.[k] == null ? "" : String(r[k]))));
    const csv = toCsv(colLabels, rowsArr);

    const proposalId = makeId("saigen");

    await db.run(
      `INSERT INTO spreadsheet_proposals
       (id, agency_id, user_id, created_by_user_id, bot_id, status, instruction, csv_snapshot, proposal_json, created_at)
       VALUES (?, ?, ?, ?, ?, 'proposed', ?, ?, ?, datetime('now'))`,
      proposalId,
      ctx.agencyId,
      ctx.userId,
      ctx.userId,
      null,
      prompt,
      csv,
      JSON.stringify({
        title,
        columns: normalizedColumns,
        rows: finalRowsObj,
        notes,
        sources: mergedSources,
        insufficient_evidence: insufficient,
        source: "web_generate",
      })
    );

    return Response.json({
      ok: true,
      plan: planKey,
      proposal_id: proposalId,
      title,
      notes,
      insufficient_evidence: insufficient,
      columns: normalizedColumns,
      rows: finalRowsObj,
      sources: mergedSources,
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

    console.error("SPREADSHEETS_AI_GENERATE_ERROR", err);
    return Response.json({ error: "Server error", message: msg }, { status: 500 });
  }
}