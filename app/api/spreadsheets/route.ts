// app/api/spreadsheets/route.ts
import type { NextRequest } from "next/server";
import { getDb, type Db } from "@/lib/db";
import { requireActiveMember } from "@/lib/authz";
import { ensureSchema } from "@/lib/schema";
import { getAgencyPlan } from "@/lib/enforcement";
import { normalizePlan, requireFeature } from "@/lib/plans";
import { openai } from "@/lib/openai";

export const runtime = "nodejs";

type ProposeBody = {
  csv?: string;
  instruction?: string;
};

function safeJsonParse(s: string): any | null {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function clampString(s: string, max: number) {
  const t = String(s ?? "");
  return t.length > max ? t.slice(0, max) : t;
}

function extractJsonFromText(text: string): any | null {
  const t = String(text || "").trim();
  if (!t) return null;

  // 1) raw JSON
  const raw = safeJsonParse(t);
  if (raw) return raw;

  // 2) fenced ```json ... ```
  const m = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (m?.[1]) {
    const inner = safeJsonParse(m[1].trim());
    if (inner) return inner;
  }

  // 3) first {...} block
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start >= 0 && end > start) {
    const inner = safeJsonParse(t.slice(start, end + 1));
    if (inner) return inner;
  }

  return null;
}

function normalizeProposal(obj: any) {
  const updatesRaw = Array.isArray(obj?.updates) ? obj.updates : [];
  const updates = updatesRaw
    .map((u: any) => {
      const row = Number(u?.row);
      const col = String(u?.col ?? "");
      const value_new = String(u?.new ?? u?.value_new ?? "");
      const value_old =
        u?.old == null ? null : typeof u?.old === "string" ? u.old : String(u.old);
      const reason = String(u?.reason ?? "");
      if (!Number.isFinite(row) || row < 1) return null;
      if (!col.trim()) return null;
      if (!value_new.trim()) return null;
      return {
        row: Math.floor(row),
        col: col.trim(),
        old: value_old,
        new: value_new,
        reason: reason ? clampString(reason, 300) : "",
      };
    })
    .filter(Boolean)
    .slice(0, 200);

  const notes = clampString(obj?.notes ?? "", 800);

  return { updates, notes };
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
    if (!gate.ok) {
      return Response.json(
        {
          ok: true,
          plan: planKey,
          upsell: {
            code: "PLAN_REQUIRED",
            message: "Upgrade to unlock spreadsheet AI proposals and updates.",
          },
        },
        { status: 200 }
      );
    }

    return Response.json({
      ok: true,
      plan: planKey,
      propose_enabled: true,
      apply_enabled: false,
    });
  } catch (err: any) {
    const msg = String(err?.code ?? err?.message ?? err);
    if (msg === "UNAUTHENTICATED") return Response.json({ error: "Unauthorized" }, { status: 401 });
    if (msg === "FORBIDDEN_NOT_ACTIVE") return Response.json({ error: "Forbidden" }, { status: 403 });

    console.error("SPREADSHEETS_GET_ERROR", err);
    return Response.json({ error: "Server error", message: msg }, { status: 500 });
  }
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

    const body = (await req.json().catch(() => null)) as ProposeBody | null;
    const csv = clampString(body?.csv ?? "", 200_000);
    const instruction = clampString(body?.instruction ?? "", 2000);

    if (!csv.trim()) return Response.json({ ok: false, error: "MISSING_CSV" }, { status: 400 });
    if (!instruction.trim()) return Response.json({ ok: false, error: "MISSING_INSTRUCTION" }, { status: 400 });

    const prompt = `
You are Louis.Ai. You propose spreadsheet edits WITHOUT applying them.

Input is a CSV snapshot of a sheet, and a user instruction describing what should change.

Return STRICT JSON ONLY with this schema:
{
  "updates": [
    { "row": 1-based row number in the CSV (including header row if present),
      "col": column name (if header exists) OR column letter (A, B, C...) if no header,
      "old": previous value (string or null if unknown),
      "new": new value (string),
      "reason": short explanation
    }
  ],
  "notes": "optional short notes"
}

Rules:
- Be conservative. If unsure, omit the update.
- Do not invent columns that don't exist.
- Keep updates under 200 items.
- JSON only, no markdown.

CSV:
${csv}

Instruction:
${instruction}
`.trim();

    const resp = await openai.responses.create({
      model: "gpt-4.1-mini",
      input: prompt,
    });

    const text =
      typeof (resp as any)?.output_text === "string" && (resp as any).output_text.trim().length > 0
        ? (resp as any).output_text.trim()
        : "";

    const parsed = extractJsonFromText(text) ?? {};
    const proposal = normalizeProposal(parsed);

    return Response.json({
      ok: true,
      plan: planKey,
      proposal,
    });
  } catch (err: any) {
    const msg = String(err?.code ?? err?.message ?? err);
    if (msg === "UNAUTHENTICATED") return Response.json({ error: "Unauthorized" }, { status: 401 });
    if (msg === "FORBIDDEN_NOT_ACTIVE") return Response.json({ error: "Forbidden" }, { status: 403 });

    console.error("SPREADSHEETS_POST_ERROR", err);
    return Response.json({ error: "Server error", message: msg }, { status: 500 });
  }
}