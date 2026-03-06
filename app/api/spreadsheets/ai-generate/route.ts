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

  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start >= 0 && end > start) {
    const inner = safeJsonParse(t.slice(start, end + 1));
    if (inner) return inner;
  }

  return null;
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
      ? body.columns.map((s) => String(s || "").trim()).filter(Boolean).slice(0, 20)
      : [];

    const system = `
You are Louis.Ai. Generate a useful starter spreadsheet from the user's prompt.
Return STRICT JSON ONLY.

Return exactly this shape:
{
  "title": string,
  "columns": [{"key": string, "label": string, "type": "text"|"number"|"date"|"currency"|"boolean"}],
  "rows": [ { "<column.key>": <value>, ... } ],
  "notes": string
}

Rules:
- No markdown
- No commentary outside JSON
- columns.length must be 1..20
- rows.length must be 1..${maxRows}
- Use snake_case keys
- Keep cells concise
- If the user supplied required columns, use them in that exact order as keys
`.trim();

    const requiredColsLine = requestedCols.length
      ? `Required columns (use these exact keys in this order): ${requestedCols.join(", ")}`
      : "Choose sensible columns based on the prompt.";

    const userInput = `
Create a starter spreadsheet.

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
    const rawRows = Array.isArray(parsed?.rows) ? parsed.rows : [];

    const normalizedColumns = (requestedCols.length
      ? requestedCols.map((key) => ({
          key,
          label: key,
          type: "text",
        }))
      : rawColumns
          .map((c: any) => {
            const key = String(c?.key ?? "").trim();
            const label = String(c?.label ?? key).trim();
            const type = String(c?.type ?? "text").trim() || "text";
            if (!key) return null;
            return { key, label, type };
          })
          .filter(Boolean)
          .slice(0, 20)) as Array<{ key: string; label: string; type: string }>;

    if (normalizedColumns.length === 0) {
      return Response.json({ ok: false, error: "NO_COLUMNS" }, { status: 500 });
    }

    const colKeys = normalizedColumns.map((c) => c.key);
    const colLabels = normalizedColumns.map((c) => c.label || c.key);

    const rowsObj = rawRows
      .map((r: any) => (r && typeof r === "object" ? r : null))
      .filter(Boolean)
      .slice(0, maxRows) as Array<Record<string, any>>;

    if (rowsObj.length === 0) {
      return Response.json({ ok: false, error: "NO_ROWS" }, { status: 500 });
    }

    const rowsArr = rowsObj.map((r) => colKeys.map((k) => (r?.[k] == null ? "" : String(r[k]))));
    const csv = toCsv(colLabels, rowsArr);

    const title = clampString(parsed?.title ?? "AI Spreadsheet Draft", 120).trim() || "AI Spreadsheet Draft";
    const notes = clampString(parsed?.notes ?? "", 1200);

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
        rows: rowsObj,
        notes,
        source: "ai_generate",
      })
    );

    return Response.json({
      ok: true,
      plan: planKey,
      proposal_id: proposalId,
      title,
      notes,
      columns: normalizedColumns,
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

    console.error("SPREADSHEETS_AI_GENERATE_ERROR", err);
    return Response.json({ error: "Server error", message: msg }, { status: 500 });
  }
}