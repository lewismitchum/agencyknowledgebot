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
  bot_id?: string;
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

  const raw = safeJsonParse(t);
  if (raw) return raw;

  const fenced = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    const inner = safeJsonParse(fenced[1].trim());
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

function normalizeProposal(obj: any) {
  const updatesRaw = Array.isArray(obj?.updates) ? obj.updates : [];
  const updates = updatesRaw
    .map((u: any) => {
      const row = Number(u?.row);
      const col = String(u?.col ?? "");
      const valueNew = String(u?.new ?? u?.value_new ?? "");
      const valueOld = u?.old == null ? null : typeof u?.old === "string" ? u.old : String(u.old);
      const reason = String(u?.reason ?? "");

      if (!Number.isFinite(row) || row < 1) return null;
      if (!col.trim()) return null;
      if (!valueNew.trim()) return null;

      return {
        row: Math.floor(row),
        col: col.trim(),
        old: valueOld,
        new: valueNew,
        reason: reason ? clampString(reason, 300) : "",
      };
    })
    .filter(Boolean)
    .slice(0, 200);

  const notes = clampString(obj?.notes ?? "", 800);

  return { updates, notes };
}

function makeId(prefix: string) {
  const uuid =
    globalThis.crypto && "randomUUID" in globalThis.crypto
      ? (globalThis.crypto as any).randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}_${uuid}`;
}

async function getAuthorizedBotId(db: Db, agencyId: string, userId: string, rawBotId?: string) {
  const botId = clampString(rawBotId ?? "", 200).trim();
  if (!botId) return null;

  const bot = await db.get(
    `SELECT id, agency_id, owner_user_id
     FROM bots
     WHERE id = ? AND agency_id = ?
     LIMIT 1`,
    botId,
    agencyId
  ) as { id: string; owner_user_id: string | null } | undefined;

  if (!bot) return null;

  const ownerUserId = bot.owner_user_id == null ? null : String(bot.owner_user_id);
  if (ownerUserId && ownerUserId !== userId) return null;

  return String(bot.id);
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
          can_apply: false,
          modes: {
            docs: false,
            csv: false,
            ai: false,
          },
          campaigns: [],
          upsell: {
            code: "PLAN_REQUIRED",
            message: "Upgrade to unlock spreadsheet AI generation and updates.",
          },
        },
        { status: 200 }
      );
    }

    const canApply = ctx.role === "owner" || ctx.role === "admin";

    const campaigns = (await db.all(
      `
      SELECT
        c.id,
        c.title,
        c.description,
        c.status,
        c.source_query,
        c.created_at,
        c.updated_at,
        COUNT(l.id) AS lead_count,
        SUM(CASE WHEN l.status = 'sent' THEN 1 ELSE 0 END) AS sent_count,
        SUM(CASE WHEN l.status = 'replied' THEN 1 ELSE 0 END) AS replied_count,
        SUM(CASE WHEN l.status = 'new' THEN 1 ELSE 0 END) AS new_count
      FROM outreach_campaigns c
      LEFT JOIN outreach_leads l
        ON l.campaign_id = c.id
      WHERE c.agency_id = ? AND c.user_id = ?
      GROUP BY c.id, c.title, c.description, c.status, c.source_query, c.created_at, c.updated_at
      ORDER BY c.created_at DESC
      `,
      ctx.agencyId,
      ctx.userId
    )) as Array<{
      id: string;
      title: string;
      description: string | null;
      status: string;
      source_query: string | null;
      created_at: string;
      updated_at: string;
      lead_count: number;
      sent_count: number;
      replied_count: number;
      new_count: number;
    }>;

    return Response.json({
      ok: true,
      plan: planKey,
      can_apply: canApply,
      propose_enabled: true,
      apply_enabled: true,
      modes: {
        docs: true,
        csv: true,
        ai: true,
      },
      campaigns: campaigns.map((c) => ({
        id: String(c.id),
        title: String(c.title || "Campaign"),
        description: c.description ? String(c.description) : "",
        status: String(c.status || "active"),
        source_query: c.source_query ? String(c.source_query) : "",
        created_at: String(c.created_at || ""),
        updated_at: String(c.updated_at || ""),
        lead_count: Number(c.lead_count || 0),
        sent_count: Number(c.sent_count || 0),
        replied_count: Number(c.replied_count || 0),
        new_count: Number(c.new_count || 0),
      })),
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

    if (!csv.trim()) {
      return Response.json({ ok: false, error: "MISSING_CSV" }, { status: 400 });
    }

    if (!instruction.trim()) {
      return Response.json({ ok: false, error: "MISSING_INSTRUCTION" }, { status: 400 });
    }

    const authorizedBotId = await getAuthorizedBotId(db, ctx.agencyId, ctx.userId, body?.bot_id);
    if (body?.bot_id && !authorizedBotId) {
      return Response.json({ ok: false, error: "BOT_NOT_FOUND_OR_FORBIDDEN" }, { status: 403 });
    }

    const prompt = `
You are Louis.Ai. You propose spreadsheet edits WITHOUT applying them.

Input is a CSV snapshot of a sheet, and a user instruction describing what should change.

Return STRICT JSON ONLY with this schema:
{
  "updates": [
    {
      "row": 1,
      "col": "Status",
      "old": "Pending",
      "new": "Paid",
      "reason": "matched invoice rule"
    }
  ],
  "notes": "optional short notes"
}

Rules:
- Be conservative. If unsure, omit the update.
- Do not invent columns that do not exist.
- Prefer header names when a header row exists.
- Keep updates under 200 items.
- JSON only. No markdown. No explanation outside JSON.

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
    const proposalId = makeId("sprop");

    await db.run(
      `INSERT INTO spreadsheet_proposals
       (id, agency_id, user_id, created_by_user_id, bot_id, status, instruction, csv_snapshot, proposal_json, created_at)
       VALUES (?, ?, ?, ?, ?, 'proposed', ?, ?, ?, datetime('now'))`,
      proposalId,
      ctx.agencyId,
      ctx.userId,
      ctx.userId,
      authorizedBotId,
      instruction,
      csv,
      JSON.stringify(proposal)
    );

    return Response.json({
      ok: true,
      plan: planKey,
      proposal_id: proposalId,
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