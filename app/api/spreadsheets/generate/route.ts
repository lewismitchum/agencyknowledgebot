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

function responseHasFileSearchEvidence(resp: any): boolean {
  // Defensive: SDK output shape drifts. Treat any appearance of file_search-ish metadata as evidence.
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
      ? body!.columns!.map((s) => String(s || "").trim()).filter(Boolean).slice(0, 40)
      : [];

    if (!userPrompt) return Response.json({ ok: false, error: "MISSING_PROMPT" }, { status: 400 });

    // UI currently doesn’t send bot_id. Choose a safe default.
    if (!botId) {
      const fallback = await getFallbackBotId(db, ctx.agencyId, ctx.userId);
      if (!fallback) return Response.json({ ok: false, error: "NO_BOTS" }, { status: 404 });
      botId = fallback;
    }

    const bot = (await db.get(
      `SELECT id, agency_id, owner_user_id, vector_store_id, name
       FROM bots
       WHERE id=? AND agency_id=?
       LIMIT 1`,
      botId,
      ctx.agencyId
    )) as
      | { id: string; agency_id: string; owner_user_id: string | null; vector_store_id: string | null; name?: string | null }
      | undefined;

    if (!bot?.id) return Response.json({ ok: false, error: "BOT_NOT_FOUND" }, { status: 404 });

    // Access rules:
    // - Agency bot (owner_user_id NULL) accessible to all active members in the agency
    // - Private bot accessible only to owner
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
- If the user provided "required columns", you MUST use them (as keys) in the output columns and rows, in that order.
`.trim();

    const requiredColsLine = requestedCols.length
      ? `\nRequired columns (use these keys in this order): ${requestedCols.join(", ")}\n`
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
      return Response.json({ ok: true, plan: planKey, bot_id: botId, fallback: true, message: FALLBACK }, { status: 200 });
    }

    const insufficient = Boolean((parsed as any)?.insufficient_evidence);

    // Spreadsheet generation is an internal action: require evidence OR fallback.
    if (!hasEvidence || insufficient) {
      return Response.json({ ok: true, plan: planKey, bot_id: botId, fallback: true, message: FALLBACK }, { status: 200 });
    }

    const title = clampString((parsed as any)?.title ?? "Spreadsheet", 120).trim() || "Spreadsheet";
    const notes = clampString((parsed as any)?.notes ?? "", 1200);

    const columnsRaw = Array.isArray((parsed as any)?.columns) ? (parsed as any).columns : [];
    const rowsRaw = Array.isArray((parsed as any)?.rows) ? (parsed as any).rows : [];

    const columnsNorm = columnsRaw
      .map((c: any) => {
        const key = String(c?.key ?? "").trim();
        const label = String(c?.label ?? "").trim();
        const type = String(c?.type ?? "text").trim();
        if (!key) return null;
        return { key, label: label || key, type: type || "text" };
      })
      .filter(Boolean)
      .slice(0, 30) as Array<{ key: string; label: string; type: string }>;

    // If required columns were provided, enforce them as canonical keys/order.
    const colKeys = requestedCols.length ? requestedCols.slice(0, 30) : columnsNorm.map((c) => c.key);
    if (colKeys.length === 0) {
      return Response.json({ ok: true, plan: planKey, bot_id: botId, fallback: true, message: FALLBACK }, { status: 200 });
    }

    // Column labels for UI/CSV header
    const labelByKey = new Map<string, string>();
    for (const c of columnsNorm) labelByKey.set(c.key, c.label || c.key);
    const colLabels = colKeys.map((k) => labelByKey.get(k) || k);

    const rowsObj = rowsRaw
      .map((r: any) => (r && typeof r === "object" ? r : null))
      .filter(Boolean)
      .slice(0, maxRows) as Array<Record<string, any>>;

    // Convert object rows -> array rows aligned with colKeys
    const rowsArr: string[][] = rowsObj.map((r) => colKeys.map((k) => (r?.[k] == null ? "" : String(r[k]))));

    const csv = toCsv(colLabels, rowsArr);

    // Save as a proposal record (auditable)
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
        columns: colLabels,
        rows: rowsArr,
        notes,
        // keep raw too (helps debugging / later sheet-writing)
        _raw: { columns: columnsNorm, rows: rowsObj },
      })
    );

    return Response.json({
      ok: true,
      plan: planKey,
      bot_id: botId,
      proposal_id: proposalId,
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