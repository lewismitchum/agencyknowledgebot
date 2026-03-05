// app/api/chat/route.ts
import { type NextRequest } from "next/server";
import { getDb, type Db } from "@/lib/db";
import { requireActiveMember } from "@/lib/authz";
import { normalizePlan, getPlanLimits } from "@/lib/plans";
import { openai } from "@/lib/openai";
import { ensureSchema } from "@/lib/schema";
import { ensureUsageDailySchema, incrementUsage } from "@/lib/usage";
import { enforceDailyMessages, getAgencyPlan } from "@/lib/enforcement";
import { getEffectiveTimezone, ymdInTz, timeStringInTz } from "@/lib/timezone";

export const runtime = "nodejs";

const FALLBACK = "I don’t have that information in the docs yet.";

type ChatBody = {
  bot_id?: string;
  message?: string;

  // Optional: client may send doc IDs or OpenAI file IDs.
  // We’ll accept either without breaking old clients.
  attachments?: string[];
  attachment_ids?: string[];
  document_ids?: string[];
  file_ids?: string[];
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

/**
 * Internal/business question detection (stricter).
 * Goal: only treat as "internal" when it plausibly depends on the user's org/client/process/docs.
 */
function looksInternalBusinessQuestion(message: string) {
  const t = message.trim().toLowerCase();

  const generalStarters = [
    "what time",
    "what day",
    "what date",
    "define ",
    "explain ",
    "summarize ",
    "translate ",
    "rewrite ",
    "draft ",
    "brainstorm ",
    "give me ideas",
    "help me",
    "how do i",
    "how to",
    "calculate",
    "solve ",
    "why ",
    "what is ",
    "who is ",
    "where is ",
  ];
  if (generalStarters.some((s) => t.startsWith(s))) return false;

  const explicitOrgMarkers = [
    "our company",
    "our agency",
    "my agency",
    "our team",
    "our client",
    "my client",
    "our customers",
    "our customer",
    "our product",
    "our service",
    "our offer",
    "our pricing",
    "our contract",
    "our invoice",
    "our onboarding",
    "our sop",
    "our process",
    "our policy",
    "our playbook",
    "our brand",
    "our messaging",
    "our kpi",
    "our dashboard",
  ];
  if (explicitOrgMarkers.some((m) => t.includes(m))) return true;

  const internalHints = [
    "pricing",
    "proposal",
    "contract",
    "invoice",
    "sow",
    "statement of work",
    "msa",
    "onboarding",
    "sop",
    "process",
    "policy",
    "playbook",
    "brand voice",
    "brand guidelines",
    "messaging",
    "deliverable",
    "scope",
    "kpi",
    "dashboard",
    "workspace settings",
    "seat limit",
    "billing",
    "stripe",
    "plan",
  ];

  return internalHints.some((h) => t.includes(h));
}

/**
 * Robust evidence detection (file_search results / citations / annotations)
 */
function responseHasFileSearchEvidence(resp: any) {
  const seen = new Set<any>();

  function isObj(v: any) {
    return v && typeof v === "object";
  }

  function hasCitationLikeArray(v: any) {
    if (!Array.isArray(v) || v.length === 0) return false;
    return v.some((x) => {
      if (!isObj(x)) return false;
      const keys = Object.keys(x);
      return (
        keys.includes("file_id") ||
        keys.includes("document_id") ||
        keys.includes("source") ||
        keys.includes("quote") ||
        keys.includes("excerpt") ||
        keys.includes("uri")
      );
    });
  }

  function walk(node: any, depth: number): boolean {
    if (depth > 14) return false;
    if (!isObj(node) && !Array.isArray(node)) return false;
    if (seen.has(node)) return false;
    seen.add(node);

    if (isObj(node)) {
      const toolName = (node.tool_name || node.name || node.tool)?.toString?.() ?? "";
      const type = (node.type || "")?.toString?.() ?? "";

      if (toolName === "file_search" || type.includes("file_search")) {
        const results = node.results ?? node.output?.results ?? node.result ?? node.output ?? node.data;
        if (Array.isArray(results) && results.length > 0) return true;
        if (results?.data && Array.isArray(results.data) && results.data.length > 0) return true;

        const citations = node.citations ?? node.output?.citations ?? node.annotations ?? node.output?.annotations;
        if (hasCitationLikeArray(citations)) return true;
      }

      const maybeCitations = node.citations ?? node.annotations;
      if (hasCitationLikeArray(maybeCitations)) return true;

      const content = node.content;
      if (Array.isArray(content)) {
        for (const c of content) {
          const anns = c?.annotations;
          if (hasCitationLikeArray(anns)) return true;
        }
      }
    }

    if (Array.isArray(node)) {
      for (const item of node) {
        if (walk(item, depth + 1)) return true;
      }
    } else {
      for (const k of Object.keys(node)) {
        const v = (node as any)[k];
        if (hasCitationLikeArray(v)) return true;
        if (walk(v, depth + 1)) return true;
      }
    }

    return false;
  }

  try {
    return walk(resp, 0);
  } catch {
    return false;
  }
}

function toUiDailyLimit(raw: unknown): number | null {
  const n = typeof raw === "number" ? raw : raw == null ? null : Number(raw);
  if (n == null || !Number.isFinite(n)) return null;
  if (n <= 0) return null;
  if (n >= 90000) return null;
  return Math.floor(n);
}

function buildMemoryInput(args: { priorSummary: string | null; messages: Array<{ role: string; content: string }> }) {
  const head = args.priorSummary ? `[Conversation Memory Summary]\n${args.priorSummary.trim()}\n\n` : "";
  const body = args.messages.map((m) => `${m.role.toUpperCase()}: ${m.content}`).join("\n");
  return head + body;
}

async function summarizeForMemory(input: string) {
  const resp = await openai.responses.create({
    model: "gpt-4.1-mini",
    input: `
You are producing durable conversation memory for a future assistant.

Rules:
- Be factual. Do not invent details.
- Keep it compact and useful.
- Preserve: key facts, user preferences, decisions, ongoing tasks, names, URLs, constraints, and open questions.
- If unsure about something, say it's unknown.
- Output plain text only.

Write as sections:
FACTS:
PREFERENCES:
DECISIONS:
OPEN ITEMS:
CONTEXT:

Conversation:
${input}
`.trim(),
  });

  const text = typeof resp.output_text === "string" && resp.output_text.trim().length > 0 ? resp.output_text.trim() : "";
  return text.slice(0, 4000);
}

async function resolveAttachments(db: Db, args: { agencyId: string; botId: string; ids: string[] }) {
  const unique = Array.from(
    new Set(
      (args.ids || [])
        .map((x) => String(x || "").trim())
        .filter(Boolean)
        .slice(0, 6)
    )
  );

  if (!unique.length) {
    return { images: [] as Array<{ openai_file_id: string; title: string }>, videos: [] as string[] };
  }

  const images: Array<{ openai_file_id: string; title: string }> = [];
  const videos: string[] = [];

  // Accept either documents.id OR documents.openai_file_id
  for (const id of unique) {
    const row = (await db.get(
      `SELECT id, title, mime_type, openai_file_id
       FROM documents
       WHERE agency_id = ?
         AND bot_id = ?
         AND (id = ? OR openai_file_id = ?)
       ORDER BY created_at DESC
       LIMIT 1`,
      args.agencyId,
      args.botId,
      id,
      id
    )) as { id?: string; title?: string | null; mime_type?: string | null; openai_file_id?: string | null } | undefined;

    if (!row?.openai_file_id) continue;

    const mime = String(row.mime_type ?? "").toLowerCase();
    if (mime.startsWith("image/")) {
      images.push({ openai_file_id: String(row.openai_file_id), title: String(row.title ?? "image") });
    } else if (mime.startsWith("video/")) {
      videos.push(String(row.title ?? "video"));
    }
  }

  return { images, videos };
}

export async function GET() {
  return Response.json({ error: "METHOD_NOT_ALLOWED" }, { status: 405 });
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireActiveMember(req);
    const db: Db = await getDb();
    await ensureSchema(db);
    await ensureUsageDailySchema(db);

    // ✅ Travel-proof timezone: header -> users.timezone -> agencies.timezone -> America/Chicago
    const tz = await getEffectiveTimezone(db, {
      agencyId: ctx.agencyId,
      userId: ctx.userId,
      headers: req.headers,
    });

    const now = new Date();
    const dateKey = ymdInTz(now, tz);

    const body = (await req.json().catch(() => null)) as ChatBody | null;
    const bot_id = String(body?.bot_id ?? "").trim();
    const message = String(body?.message ?? "").trim();

    if (!bot_id) return Response.json({ error: "Missing bot_id" }, { status: 400 });
    if (!message) return Response.json({ error: "Missing message" }, { status: 400 });

    const plan = await getAgencyPlan(db, ctx.agencyId, ctx.plan);

    const gate = await enforceDailyMessages(db, ctx.agencyId, dateKey, plan);
    if (!gate.ok) return Response.json(gate.body, { status: gate.status });

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

    // Attachments (optional)
    const rawAttach =
      (Array.isArray(body?.attachments) ? body!.attachments : null) ??
      (Array.isArray(body?.attachment_ids) ? body!.attachment_ids : null) ??
      (Array.isArray(body?.document_ids) ? body!.document_ids : null) ??
      (Array.isArray(body?.file_ids) ? body!.file_ids : null) ??
      [];

    const { images: imageFiles, videos: videoTitles } = await resolveAttachments(db, {
      agencyId: ctx.agencyId,
      botId: bot_id,
      ids: rawAttach,
    });

    const convo = await getOrCreateConversation(db, {
      agencyId: ctx.agencyId,
      userId: ctx.userId,
      botId: bot_id,
    });

    // Store user message (include small attachment note for continuity)
    const attachNote =
      imageFiles.length || videoTitles.length
        ? `\n\n[Attachments]\n${
            imageFiles.length ? `Images: ${imageFiles.map((x) => x.title).join(", ")}` : ""
          }${imageFiles.length && videoTitles.length ? "\n" : ""}${
            videoTitles.length ? `Videos: ${videoTitles.join(", ")}` : ""
          }\n`
        : "";

    await insertMessage(db, convo.id, "user", message + attachNote);

    // Build input for model (summary + last 20)
    const recent = await loadRecentMessages(db, convo.id, 20);
    const tools = bot.vector_store_id ? [{ type: "file_search" as const, vector_store_ids: [bot.vector_store_id] }] : [];

    const openaiInputText = buildMemoryInput({ priorSummary: convo.summary, messages: recent });

    let answer: string;

    if (looksLikeTimeQuestion(message)) {
      answer = timeStringInTz(now, tz);
    } else {
      const internal = looksInternalBusinessQuestion(message);

      const hasImages = imageFiles.length > 0;
      const hasVideos = videoTitles.length > 0;

      const mediaHint = hasImages
        ? "The user attached one or more images. You CAN analyze the images and answer questions about what’s in them."
        : "If the user asks about the contents of an image/video file, be honest: you may not be able to see pixels/audio. Use file_search evidence only.";

      const inputBlocks: any[] = [
        {
          role: "user",
          content: [
            { type: "input_text", text: openaiInputText },
            ...imageFiles.map((img) => ({
              type: "input_image",
              image_file_id: img.openai_file_id,
            })),
          ],
        },
      ];

      const resp = await openai.responses.create({
        model: "gpt-4.1-mini",
        instructions: `
You are Louis.Ai.

Behavior:
- Docs-first: for internal/business questions, prioritize uploaded docs via file_search.
- General questions (non-internal): answer normally using general knowledge/reasoning.
- Never fabricate internal/company-specific details.
- ${mediaHint}
- If (and only if) the question is internal/business AND file_search found no relevant evidence, reply exactly:
${FALLBACK}
Do not add extra words before or after the fallback.
${
  hasVideos
    ? "\nNote: The user attached video(s). Video understanding is not available yet unless transcript/frame data is provided."
    : ""
}
`.trim(),
        input: inputBlocks,
        tools,
      });

      const modelText =
        typeof resp.output_text === "string" && resp.output_text.trim().length > 0 ? resp.output_text.trim() : "";

      const hasEvidence = tools.length > 0 ? responseHasFileSearchEvidence(resp) : false;

      if (internal && tools.length === 0) {
        answer = FALLBACK;
      } else if (internal && tools.length > 0 && !hasEvidence) {
        answer = FALLBACK;
      } else {
        answer = modelText || (internal ? FALLBACK : "Sorry — I couldn’t generate a response.");
      }
    }

    await insertMessage(db, convo.id, "assistant", answer);

    // Usage (1 per call)
    const usageRow = await incrementUsage(db, ctx.agencyId, dateKey, "messages", 1);

    // ===== Memory refresh (transactional, safe) =====
    const planKey = normalizePlan(plan);
    const threshold = summarizeThresholdForPlan(planKey);

    const newCount = Number(convo.message_count ?? 0) + 2;

    if (newCount >= threshold) {
      const msgsForSummary = await loadRecentMessages(db, convo.id, 120);
      const memoryInput = buildMemoryInput({ priorSummary: convo.summary, messages: msgsForSummary });

      let nextSummary = "";
      try {
        nextSummary = await summarizeForMemory(memoryInput);
      } catch {
        nextSummary = "";
      }

      if (nextSummary && nextSummary.trim().length) {
        await db.exec("BEGIN");
        try {
          await db.run(
            `UPDATE conversations
             SET summary = ?, message_count = 0, updated_at = ?
             WHERE id = ?`,
            nextSummary.trim(),
            nowIso(),
            convo.id
          );

          await db.run(`DELETE FROM conversation_messages WHERE conversation_id = ?`, convo.id);

          await db.exec("COMMIT");
        } catch {
          await db.exec("ROLLBACK");
          await db.run(
            `UPDATE conversations
             SET message_count = message_count + 2, updated_at = ?
             WHERE id = ?`,
            nowIso(),
            convo.id
          );
        }
      } else {
        await db.run(
          `UPDATE conversations
           SET message_count = message_count + 2, updated_at = ?
           WHERE id = ?`,
          nowIso(),
          convo.id
        );
      }
    } else {
      await db.run(
        `UPDATE conversations
         SET message_count = message_count + 2, updated_at = ?
         WHERE id = ?`,
        nowIso(),
        convo.id
      );
    }

    const limits = getPlanLimits(planKey);
    const dailyLimitUi = toUiDailyLimit((limits as any)?.daily_messages);

    return Response.json({
      ok: true,
      answer,
      usage: {
        used: usageRow.messages_count,
        daily_limit: dailyLimitUi,
        plan: planKey,
        timezone: tz,
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