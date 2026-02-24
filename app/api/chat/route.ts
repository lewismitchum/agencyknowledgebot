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
  if (p === "corporation") return 60;
  return 40;
}

function nowIso() {
  return new Date().toISOString();
}

function makeId(prefix: string) {
  const uuid =
    globalThis.crypto && "randomUUID" in globalThis.crypto
      ? (globalThis.crypto as any).randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}_${uuid}`;
}

function looksLikeTimeQuestion(s: string) {
  const t = s.trim().toLowerCase();
  return t === "what time is it" || t.includes("current time") || t.includes("time is it");
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

async function getAgencyTimezone(db: Db, agencyId: string) {
  const row = (await db.get(`SELECT timezone FROM agencies WHERE id = ? LIMIT 1`, agencyId)) as
    | { timezone?: string | null }
    | undefined;

  const tz = String(row?.timezone ?? "").trim();
  return tz || "America/Chicago";
}

function ymdInTz(tz: string) {
  // en-CA -> YYYY-MM-DD
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
  } catch {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Chicago",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
  }
}

async function getDailyUsage(db: Db, agencyId: string, date: string) {
  const row = (await db.get(
    `SELECT messages_count, uploads_count
     FROM usage_daily
     WHERE agency_id = ? AND date = ?
     LIMIT 1`,
    agencyId,
    date
  )) as { messages_count?: number; uploads_count?: number } | undefined;

  return {
    messages_count: Number(row?.messages_count ?? 0),
    uploads_count: Number(row?.uploads_count ?? 0),
  };
}

async function ensureUsageRow(db: Db, agencyId: string, date: string) {
  await db.run(
    `INSERT OR IGNORE INTO usage_daily (agency_id, date, messages_count, uploads_count)
     VALUES (?, ?, 0, 0)`,
    agencyId,
    date
  );
}

async function incrementMessages(db: Db, agencyId: string, date: string) {
  await ensureUsageRow(db, agencyId, date);
  await db.run(
    `UPDATE usage_daily
     SET messages_count = messages_count + 1
     WHERE agency_id = ? AND date = ?`,
    agencyId,
    date
  );
}

async function enforceDailyLimit(db: Db, agencyId: string, planFromCtx: string | null, dateKey: string) {
  const planRow = (await db.get(`SELECT plan FROM agencies WHERE id = ? LIMIT 1`, agencyId)) as
    | { plan?: string | null }
    | undefined;

  const rawPlan = planRow?.plan ?? planFromCtx ?? null;
  const plan = normalizePlan(rawPlan);

  const limits = getPlanLimits(plan);
  const dailyLimit = limits.daily_messages;

  if (dailyLimit == null || Number(dailyLimit) <= 0) {
    return { ok: true as const, used: 0, dailyLimit: null as number | null, plan };
  }

  const usage = await getDailyUsage(db, agencyId, dateKey);

  if (usage.messages_count >= Number(dailyLimit)) {
    return { ok: false as const, used: usage.messages_count, dailyLimit: Number(dailyLimit), plan };
  }

  return { ok: true as const, used: usage.messages_count, dailyLimit: Number(dailyLimit), plan };
}

async function getOrCreateConversation(db: Db, args: { agencyId: string; userId: string; botId: string }) {
  const existing = (await db.get(
    `SELECT id, summary, message_count
     FROM conversations
     WHERE agency_id = ? AND owner_user_id = ? AND bot_id = ?
     LIMIT 1`,
    args.agencyId,
    args.userId,
    args.botId
  )) as { id?: string; summary?: string | null; message_count?: number } | undefined;

  if (existing?.id) {
    return {
      id: existing.id,
      summary: existing.summary ?? null,
      message_count: Number(existing.message_count ?? 0),
    };
  }

  const id = makeId("convo");

  await db.run(
    `INSERT INTO conversations
     (id, agency_id, owner_user_id, bot_id, summary, message_count, created_at, updated_at)
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

async function insertMessage(db: Db, convoId: string, role: "user" | "assistant", content: string) {
  await db.run(
    `INSERT INTO conversation_messages
     (id, conversation_id, role, content, created_at)
     VALUES (?, ?, ?, ?, ?)`,
    makeId("msg"),
    convoId,
    role,
    content,
    nowIso()
  );
}

async function loadRecentMessages(db: Db, convoId: string, limit: number) {
  const rows = (await db.all(
    `SELECT role, content
     FROM conversation_messages
     WHERE conversation_id = ?
     ORDER BY created_at DESC
     LIMIT ?`,
    convoId,
    limit
  )) as Array<{ role?: string; content?: string }>;

  return rows.reverse().map((r) => ({
    role: r.role === "assistant" ? "assistant" : "user",
    content: String(r.content ?? ""),
  }));
}

async function shouldSummarize(plan: string, messageCount: number) {
  const threshold = summarizeThresholdForPlan(plan);
  return messageCount >= threshold;
}

async function summarizeConversation(openaiInput: string) {
  const resp = await openai.responses.create({
    model: "gpt-4.1-mini",
    input: `Summarize the conversation as compact memory for future turns. Keep it factual, short, and action-oriented.\n\n${openaiInput}`,
  });

  const text =
    typeof resp.output_text === "string" && resp.output_text.trim().length > 0
      ? resp.output_text.trim()
      : "";

  return text.slice(0, 4000);
}

export async function GET() {
  return Response.json({ error: "METHOD_NOT_ALLOWED" }, { status: 405 });
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireActiveMember(req);
    const db: Db = await getDb();
    await ensureSchema(db);

    const agencyTz = await getAgencyTimezone(db, ctx.agencyId);
    const dateKey = ymdInTz(agencyTz);

    const body = (await req.json().catch(() => null)) as ChatBody | null;
    const bot_id = String(body?.bot_id ?? "").trim();
    const message = String(body?.message ?? "").trim();

    if (!bot_id) return Response.json({ error: "Missing bot_id" }, { status: 400 });
    if (!message) return Response.json({ error: "Missing message" }, { status: 400 });

    const usageGate = await enforceDailyLimit(db, ctx.agencyId, ctx.plan, dateKey);
    if (!usageGate.ok) {
      return Response.json(
        {
          error: "DAILY_LIMIT_EXCEEDED",
          used: usageGate.used,
          daily_limit: usageGate.dailyLimit,
          plan: usageGate.plan,
          timezone: agencyTz,
          date: dateKey,
        },
        { status: 429 }
      );
    }

    const bot = (await db.get(
      `SELECT id, vector_store_id
       FROM bots
       WHERE id = ? AND agency_id = ?
         AND (owner_user_id IS NULL OR owner_user_id = ?)
       LIMIT 1`,
      bot_id,
      ctx.agencyId,
      ctx.userId
    )) as { id?: string; vector_store_id?: string | null } | undefined;

    if (!bot?.id) return Response.json({ error: "Bot not found" }, { status: 404 });

    const convo = await getOrCreateConversation(db, {
      agencyId: ctx.agencyId,
      userId: ctx.userId,
      botId: bot_id,
    });

    await insertMessage(db, convo.id, "user", message);

    const recent = await loadRecentMessages(db, convo.id, 20);

    const tools = bot.vector_store_id
      ? [{ type: "file_search" as const, vector_store_ids: [bot.vector_store_id] }]
      : [];

    const openaiInput =
      (convo.summary ? `Conversation memory:\n${convo.summary}\n\n` : "") +
      recent.map((m) => `${m.role.toUpperCase()}: ${m.content}`).join("\n");

    let answer: string;

    if (looksLikeTimeQuestion(message)) {
      answer = chicagoTimeString();
    } else {
      const resp = await openai.responses.create({
        model: "gpt-4.1-mini",
        instructions: `
You are Louis.Ai.

Rules:
- Docs are prioritized, not exclusive.
- Always answer general questions normally.
- For internal agency questions, consult file_search.
- If no relevant evidence is found for internal business questions, reply exactly:
${FALLBACK}
Never fabricate internal details.
`.trim(),
        input: openaiInput,
        tools,
      });

      answer =
        typeof resp.output_text === "string" && resp.output_text.trim().length > 0
          ? resp.output_text.trim()
          : FALLBACK;
    }

    await insertMessage(db, convo.id, "assistant", answer);

    // Count 1 user message per call (what billing cares about)
    await incrementMessages(db, ctx.agencyId, dateKey);

    // auto-summarize + compact memory (plan-aware)
    const plan = normalizePlan(usageGate.plan);
    const newCount = Number(convo.message_count ?? 0) + 2;

    if (await shouldSummarize(plan, newCount)) {
      const summary = await summarizeConversation(openaiInput + `\nASSISTANT: ${answer}`);

      await db.run(
        `UPDATE conversations
         SET summary = ?, message_count = 0, updated_at = ?
         WHERE id = ?`,
        summary || null,
        nowIso(),
        convo.id
      );

      await db.run(`DELETE FROM conversation_messages WHERE conversation_id = ?`, convo.id);
    } else {
      await db.run(
        `UPDATE conversations
         SET message_count = message_count + 2, updated_at = ?
         WHERE id = ?`,
        nowIso(),
        convo.id
      );
    }

    return Response.json({
      ok: true,
      answer,
      usage: {
        used: usageGate.used + 1,
        daily_limit: usageGate.dailyLimit,
        plan: usageGate.plan,
        timezone: agencyTz,
        date: dateKey,
      },
    });
  } catch (err: any) {
    const msg = String(err?.code ?? err?.message ?? err);
    if (msg === "UNAUTHENTICATED") return Response.json({ error: "Unauthorized" }, { status: 401 });
    if (msg === "FORBIDDEN_NOT_ACTIVE") return Response.json({ error: "Pending approval" }, { status: 403 });

    console.error("CHAT_ROUTE_ERROR", err);
    return Response.json({ error: "Server error", message: msg }, { status: 500 });
  }
}