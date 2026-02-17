// app/api/chat/route.ts
import type { NextRequest } from "next/server";
import { getDb, type Db } from "@/lib/db";
import { requireActiveMember } from "@/lib/authz";
import { getPlanLimits, normalizePlan } from "@/lib/plans";
import { openai } from "@/lib/openai";
import { ensureSchema } from "@/lib/schema";

export const runtime = "nodejs";

const FALLBACK = "I don’t have that information in the docs yet.";

type ChatBody = {
  bot_id?: string;
  message?: string;
};

function summarizeThresholdForPlan(plan: string | null) {
  const p = String(plan ?? "free").toLowerCase();
  if (p === "free") return 20;
  if (p === "starter") return 30;
  if (p === "pro") return 40;
  if (p === "enterprise") return 50;
  return 40;
}

function nowIso() {
  return new Date().toISOString();
}

function makeId(prefix: string) {
  const uuid =
    globalThis.crypto && "randomUUID" in globalThis.crypto && (globalThis.crypto as any).randomUUID
      ? (globalThis.crypto as any).randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}_${uuid}`;
}

function looksLikeTimeQuestion(s: string) {
  const t = s.trim().toLowerCase();
  return (
    t === "what time is it" ||
    t === "whats the time" ||
    t === "what's the time" ||
    t.includes("what time is it") ||
    t.includes("current time") ||
    t.includes("time is it")
  );
}

function chicagoTimeString() {
  const dt = new Date();
  const time = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(dt);

  const date = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(dt);

  return `It’s ${time} in Chicago (${date}).`;
}

// Canonical daily key (UTC). Keep consistent across chat + uploads.
function todayYmd() {
  const d = new Date();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

async function getDailyUsage(db: Db, agencyId: string, date: string) {
  const row = (await db.get(
    `SELECT messages_count, uploads_count
     FROM usage_daily
     WHERE agency_id = ? AND date = ?
     LIMIT 1`,
    agencyId,
    date
  )) as { messages_count: number; uploads_count: number } | undefined;

  return {
    messages_count: Number(row?.messages_count ?? 0),
    uploads_count: Number(row?.uploads_count ?? 0),
  };
}

async function incrementMessages(db: Db, agencyId: string, date: string) {
  await db.run(
    `INSERT INTO usage_daily (agency_id, date, messages_count, uploads_count)
     VALUES (?, ?, 1, 0)
     ON CONFLICT(agency_id, date)
     DO UPDATE SET messages_count = messages_count + 1`,
    agencyId,
    date
  );
}

async function enforceDailyLimit(db: Db, agencyId: string, planFromCtx: string | null) {
  const planRow = (await db.get(`SELECT plan FROM agencies WHERE id = ? LIMIT 1`, agencyId)) as
    | { plan: string | null }
    | undefined;

  const rawPlan = planRow?.plan ?? planFromCtx ?? null;
  const plan = normalizePlan(rawPlan);
  const limits = getPlanLimits(plan);

  const dailyLimit = (limits as any).daily_messages ?? (limits as any).dailyMessages ?? null;

  // Unlimited plan (or plan model returns null/undefined for unlimited)
  if (dailyLimit == null) {
    return { ok: true as const, used: 0, dailyLimit: null as number | null, plan };
  }

  const date = todayYmd();
  const usage = await getDailyUsage(db, agencyId, date);

  if (usage.messages_count >= dailyLimit) {
    return { ok: false as const, used: usage.messages_count, dailyLimit, plan };
  }

  return { ok: true as const, used: usage.messages_count, dailyLimit, plan };
}

async function getOrCreateConversation(
  db: Db,
  args: { agencyId: string; userId: string; botId: string }
): Promise<{ id: string; summary: string | null; message_count: number }> {
  const existing = (await db.get(
    `SELECT id, summary, message_count
     FROM conversations
     WHERE agency_id = ? AND user_id = ? AND bot_id = ?
     LIMIT 1`,
    args.agencyId,
    args.userId,
    args.botId
  )) as { id: string; summary: string | null; message_count: number | null } | undefined;

  if (existing?.id) {
    return {
      id: existing.id,
      summary: existing.summary ?? null,
      message_count: Number(existing.message_count ?? 0),
    };
  }

  const id = makeId("convo");
  await db.run(
    `INSERT INTO conversations (id, agency_id, user_id, bot_id, summary, message_count, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    args.agencyId,
    args.userId,
    args.botId,
    null,
    0,
    nowIso(),
    nowIso()
  );

  return { id, summary: null, message_count: 0 };
}

async function bumpMessageCount(db: Db, convoId: string, inc: number): Promise<void> {
  await db.run(
    `UPDATE conversations
     SET message_count = COALESCE(message_count, 0) + ?, updated_at = ?
     WHERE id = ?`,
    inc,
    nowIso(),
    convoId
  );
}

async function insertMessage(
  db: Db,
  args: {
    agencyId: string;
    userId: string;
    botId: string;
    convoId: string;
    role: "user" | "assistant";
    content: string;
  }
): Promise<void> {
  await db.run(
    `INSERT INTO conversation_messages
     (id, agency_id, user_id, bot_id, conversation_id, role, content, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    makeId("msg"),
    args.agencyId,
    args.userId,
    args.botId,
    args.convoId,
    args.role,
    args.content,
    nowIso()
  );
}

async function loadRecentMessages(
  db: Db,
  args: { convoId: string; limit: number }
): Promise<Array<{ role: "user" | "assistant"; content: string }>> {
  const rows = (await db.all(
    `SELECT role, content
     FROM conversation_messages
     WHERE conversation_id = ?
     ORDER BY created_at DESC
     LIMIT ?`,
    args.convoId,
    args.limit
  )) as Array<{ role: string; content: string }>;

  return rows
    .slice()
    .reverse()
    .map((r) => ({
      role: r.role === "assistant" ? "assistant" : "user",
      content: String(r.content ?? ""),
    }));
}

async function maybeSummarize(
  db: Db,
  args: {
    convoId: string;
    existingSummary: string | null;
    messageCount: number;
    threshold: number;
  }
): Promise<string | null> {
  if (args.messageCount < args.threshold) return args.existingSummary ?? null;

  const recent = await loadRecentMessages(db, { convoId: args.convoId, limit: 40 });

  const summaryPrompt = `
Summarize this conversation for future continuity.
Rules:
- Keep all critical facts, decisions, constraints, and TODOs.
- Preserve names of routes, tables, file paths, and key bugs/fixes.
- Be concise but complete.
Output plain text only.
`.trim();

  let resp: any;
  try {
    resp = await openai.responses.create({
      model: "gpt-4.1-mini",
      instructions: summaryPrompt,
      input: `Existing summary:\n${args.existingSummary || "(none)"}\n\nRecent messages:\n${recent
        .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
        .join("\n")}`,
    });
  } catch {
    return args.existingSummary ?? null;
  }

  const newSummary = String(resp?.output_text ?? "").trim() || (args.existingSummary ?? null);

  await db.run(
    `UPDATE conversations
     SET summary = ?, message_count = 0, updated_at = ?
     WHERE id = ?`,
    newSummary,
    nowIso(),
    args.convoId
  );

  try {
    await db.run(`DELETE FROM conversation_messages WHERE conversation_id = ?`, args.convoId);
  } catch {}

  return newSummary;
}

// 👇 This prevents the “mystery 405” when something hits GET /api/chat
export async function GET() {
  return Response.json(
    { error: "METHOD_NOT_ALLOWED", hint: "Use POST /api/chat" },
    { status: 405 }
  );
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireActiveMember(req);

    // ✅ Get DB first, then ensure schema on that DB (consistent + avoids silent failures)
    const db: Db = await getDb();
    await ensureSchema(db).catch((err) => {
      console.error("SCHEMA_ENSURE_FAILED", err);
    });

    const body = (await req.json().catch(() => null)) as ChatBody | null;
    const bot_id = String(body?.bot_id || "").trim();
    const message = String(body?.message || "").trim();

    if (!bot_id) return Response.json({ error: "Missing bot_id" }, { status: 400 });
    if (!message) return Response.json({ error: "Missing message" }, { status: 400 });

    if (looksLikeTimeQuestion(message)) {
      return Response.json({ ok: true, answer: chicagoTimeString(), source: "system" });
    }

    // ✅ Server-side daily limits (do NOT bump until success)
    const usage = await enforceDailyLimit(db, ctx.agencyId, ctx.plan);
    if (!usage.ok) {
      return Response.json(
        {
          ok: false,
          error: "DAILY_LIMIT_EXCEEDED",
          used: usage.used,
          daily_limit: usage.dailyLimit,
          plan: usage.plan,
        },
        { status: 429 }
      );
    }

    const bot = (await db.get(
      `SELECT id, vector_store_id, owner_user_id
       FROM bots
       WHERE id = ? AND agency_id = ?
         AND (owner_user_id IS NULL OR owner_user_id = ?)
       LIMIT 1`,
      bot_id,
      ctx.agencyId,
      ctx.userId
    )) as { id: string; vector_store_id: string | null; owner_user_id: string | null } | undefined;

    if (!bot?.id) return Response.json({ error: "Bot not found" }, { status: 404 });

    const convo = await getOrCreateConversation(db, {
      agencyId: ctx.agencyId,
      userId: ctx.userId,
      botId: bot_id,
    });

    await insertMessage(db, {
      agencyId: ctx.agencyId,
      userId: ctx.userId,
      botId: bot_id,
      convoId: convo.id,
      role: "user",
      content: message,
    });
    await bumpMessageCount(db, convo.id, 1);

    const refreshedSummary = await maybeSummarize(db, {
      convoId: convo.id,
      existingSummary: convo.summary,
      messageCount: convo.message_count + 1,
      threshold: summarizeThresholdForPlan(ctx.plan),
    });

    const recent = await loadRecentMessages(db, { convoId: convo.id, limit: 20 });

    const instructions = `
You are Louis.Ai, a secure internal assistant for an agency.
Rules:
- For internal/business answers: you MUST rely on uploaded documents.
- Use the file_search tool to find relevant info in the agency's docs.
- If the docs do not contain the answer, reply EXACTLY with:
${FALLBACK}
- Do not invent facts.
- Keep answers direct.
`.trim();

    const memoryBlock = refreshedSummary ? `Conversation memory:\n${refreshedSummary}\n` : "";

    let resp: any;
    try {
      resp = await openai.responses.create({
        model: "gpt-4.1-mini",
        instructions,
        input:
          memoryBlock +
          `Most recent messages:\n` +
          recent.map((m) => `${m.role.toUpperCase()}: ${m.content}`).join("\n"),
        tools: bot.vector_store_id
          ? [
              {
                type: "file_search",
                vector_store_ids: [bot.vector_store_id],
              },
            ]
          : [],
      });
    } catch (e: any) {
      const msg = String(e?.message ?? e);
      return Response.json({ ok: true, answer: FALLBACK, openai_error: msg });
    }

    const answer = String(resp?.output_text ?? "").trim() || FALLBACK;

    await insertMessage(db, {
      agencyId: ctx.agencyId,
      userId: ctx.userId,
      botId: bot_id,
      convoId: convo.id,
      role: "assistant",
      content: answer,
    });
    await bumpMessageCount(db, convo.id, 1);

    // ✅ Bump usage ONLY after successful assistant response
    await incrementMessages(db, ctx.agencyId, todayYmd());

    return Response.json({ ok: true, answer });
  } catch (err: any) {
    const msg = String(err?.code ?? err?.message ?? err);
    if (msg === "UNAUTHENTICATED") return Response.json({ error: "Unauthorized" }, { status: 401 });
    if (msg === "FORBIDDEN_NOT_ACTIVE") return Response.json({ error: "Pending approval" }, { status: 403 });
    if (msg === "FORBIDDEN_NOT_OWNER") return Response.json({ error: "Owner only" }, { status: 403 });

    console.error("CHAT_ROUTE_ERROR", err);
    return Response.json({ error: "Server error", message: msg }, { status: 500 });
  }
}
