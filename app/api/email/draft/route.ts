// app/api/email/draft/route.ts
import type { NextRequest } from "next/server";
import { getDb, type Db } from "@/lib/db";
import { requireActiveMember } from "@/lib/authz";
import { ensureSchema } from "@/lib/schema";
import { getAgencyPlan } from "@/lib/enforcement";
import { normalizePlan, requireFeature } from "@/lib/plans";
import { openai } from "@/lib/openai";

export const runtime = "nodejs";

const FALLBACK = "I don’t have that information in the docs yet.";

type DraftBody = {
  bot_id?: string;
  prompt?: string;
  tone?: "friendly" | "direct" | "formal" | string;
  recipient?: { name?: string; company?: string };
};

function clampString(s: unknown, max: number) {
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

function makeId(prefix: string) {
  const uuid =
    globalThis.crypto && "randomUUID" in globalThis.crypto
      ? (globalThis.crypto as any).randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}_${uuid}`;
}

async function getEmailDraftColumns(db: Db): Promise<string[]> {
  try {
    const rows = (await db.all(`PRAGMA table_info("email_drafts")`)) as Array<{ name: string }>;
    return rows.map((r) => r.name);
  } catch {
    return [];
  }
}

function responseHasFileSearchEvidence(resp: any) {
  // Defensive: SDK output shape drifts.
  // We treat any recognizable file_search tool output / citations as evidence.
  try {
    const s = JSON.stringify(resp ?? {});
    if (s.includes("file_search") || s.includes("citations") || s.includes("citation")) return true;

    const outputs = Array.isArray(resp?.output) ? resp.output : [];
    for (const item of outputs) {
      const toolName = (item?.tool_name || item?.name || item?.tool)?.toString?.() ?? "";
      const type = (item?.type || "").toString();

      if (toolName === "file_search" || type.includes("file_search")) {
        const results = item?.results ?? item?.output?.results ?? item?.result ?? item?.output;
        if (Array.isArray(results) && results.length > 0) return true;
        if (results?.data && Array.isArray(results.data) && results.data.length > 0) return true;

        const citations = item?.citations ?? item?.output?.citations;
        if (Array.isArray(citations) && citations.length > 0) return true;
      }
    }
  } catch {
    // ignore
  }
  return false;
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

async function assertBotAccessAndGetVectorStore(db: Db, args: { bot_id: string; agency_id: string; user_id: string }) {
  const bot = (await db.get(
    `SELECT id, vector_store_id, owner_user_id, agency_id
     FROM bots
     WHERE id = ? AND agency_id = ?
       AND (owner_user_id IS NULL OR owner_user_id = ?)
     LIMIT 1`,
    args.bot_id,
    args.agency_id,
    args.user_id
  )) as
    | { id: string; vector_store_id: string | null; owner_user_id: string | null; agency_id: string }
    | undefined;

  if (!bot?.id) return { ok: false as const, error: "BOT_NOT_FOUND" as const };

  const vs = String(bot.vector_store_id ?? "").trim();
  if (!vs) return { ok: false as const, error: "BOT_VECTOR_STORE_MISSING" as const };

  return { ok: true as const, bot_id: bot.id, vector_store_id: vs };
}

function normalizeDraft(obj: any) {
  const subject = clampString(obj?.subject ?? "", 160).trim();
  const body = clampString(obj?.body ?? "", 30_000).trim();

  if (!subject || !body) return { ok: false as const, error: "INVALID_DRAFT" as const };

  return { ok: true as const, draft: { subject, body } };
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

    const gate = requireFeature(planKey, "email");
    if (!gate.ok) return Response.json(gate.body, { status: gate.status });

    const body = (await req.json().catch(() => null)) as DraftBody | null;

    let bot_id = clampString(body?.bot_id ?? "", 120).trim();
    if (!bot_id) {
      const fallback = await getFallbackBotId(db, ctx.agencyId, ctx.userId);
      if (!fallback) return Response.json({ ok: false, error: "NO_BOTS" }, { status: 404 });
      bot_id = fallback;
    }

    const prompt = clampString(body?.prompt ?? "", 6000).trim();
    if (!prompt) return Response.json({ ok: false, error: "MISSING_PROMPT" }, { status: 400 });

    const tone = clampString(body?.tone ?? "direct", 40).trim() || "direct";
    const recipName = clampString(body?.recipient?.name ?? "", 120).trim();
    const recipCompany = clampString(body?.recipient?.company ?? "", 120).trim();

    const ensured = await assertBotAccessAndGetVectorStore(db, {
      bot_id,
      agency_id: ctx.agencyId,
      user_id: ctx.userId,
    });

    if (!ensured.ok) {
      if (ensured.error === "BOT_VECTOR_STORE_MISSING") {
        return Response.json({ ok: false, error: "BOT_VECTOR_STORE_MISSING" }, { status: 409 });
      }
      return Response.json({ ok: false, error: "BOT_NOT_FOUND" }, { status: 404 });
    }

    const tools = [{ type: "file_search" as const, vector_store_ids: [ensured.vector_store_id] }];

    const recipientLine =
      recipName || recipCompany ? `Recipient: ${[recipName, recipCompany].filter(Boolean).join(" — ")}` : "";

    const instruction = `
You are Louis.Ai.

Task:
Draft an email based ONLY on evidence from the user's uploaded docs (via file_search).
Do NOT invent internal facts, commitments, timelines, pricing, policies, or names.
If the docs do not contain enough evidence to draft this email, reply EXACTLY:
${FALLBACK}

Output format:
- If you can draft the email, return STRICT JSON ONLY:
{
  "subject": "…",
  "body": "…"
}

Rules:
- JSON only, no markdown.
- Tone: ${tone}
${recipientLine ? `- ${recipientLine}` : ""}

User request:
${prompt}
`.trim();

    const resp = await openai.responses.create({
      model: "gpt-4.1-mini",
      input: instruction,
      tools,
    });

    const text =
      typeof (resp as any)?.output_text === "string" && (resp as any).output_text.trim().length > 0
        ? (resp as any).output_text.trim()
        : "";

    const hasEvidence = responseHasFileSearchEvidence(resp);

    if (!hasEvidence || text === FALLBACK) {
      return Response.json({ ok: true, plan: planKey, bot_id, fallback: true, message: FALLBACK }, { status: 200 });
    }

    const parsed = extractJsonFromText(text);
    const normalized = normalizeDraft(parsed ?? {});
    if (!normalized.ok) {
      return Response.json({ ok: true, plan: planKey, bot_id, fallback: true, message: FALLBACK }, { status: 200 });
    }

    const draftId = makeId("edraft");

    // Drift-safe insert:
    // - New canonical: email_drafts includes user_id
    // - Legacy: only created_by_user_id exists
    const cols = await getEmailDraftColumns(db);
    const hasUserId = cols.includes("user_id");

    if (hasUserId) {
      await db.run(
        `INSERT INTO email_drafts
         (id, agency_id, user_id, bot_id, created_by_user_id, prompt, subject, body, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
        draftId,
        ctx.agencyId,
        ctx.userId,
        bot_id,
        ctx.userId,
        prompt,
        normalized.draft.subject,
        normalized.draft.body
      );
    } else {
      await db.run(
        `INSERT INTO email_drafts
         (id, agency_id, bot_id, created_by_user_id, prompt, subject, body, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
        draftId,
        ctx.agencyId,
        bot_id,
        ctx.userId,
        prompt,
        normalized.draft.subject,
        normalized.draft.body
      );
    }

    return Response.json({
      ok: true,
      plan: planKey,
      bot_id,
      draft_id: draftId,
      draft: normalized.draft,
    });
  } catch (err: any) {
    const msg = String(err?.code ?? err?.message ?? err);
    if (msg === "UNAUTHENTICATED") return Response.json({ error: "Unauthorized" }, { status: 401 });
    if (msg === "FORBIDDEN_NOT_ACTIVE") return Response.json({ error: "Forbidden" }, { status: 403 });

    console.error("EMAIL_DRAFT_ERROR", err);
    return Response.json({ error: "Server error", message: msg }, { status: 500 });
  }
}