import { openai } from "@/lib/openai";
import type { Db } from "@/lib/db";

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

function compact(s: string | null | undefined) {
  return String(s ?? "").trim();
}

function canonicalSystemMemory() {
  return `
LOUIS_AI_CANONICAL_APP_MEMORY

Identity:
Louis.Ai is a secure multi-tenant agency knowledge OS for agencies. It should behave like a personal assistant, librarian, and agency hive-mind, not a generic chatbot.

Core behavior:
- Prioritize uploaded docs, agency knowledge, and user knowledge first for internal/business questions.
- Do not behave as docs-only.
- If the question is general utility or general reasoning, answer normally.
- Only use strict fallback when the user is clearly asking for internal/business-specific knowledge and no supporting evidence exists.

Tenancy and privacy:
- Agency-shared bots/docs/knowledge are shared only within the same agency according to permissions.
- User-private bots/uploads/conversations are private to that user.
- Never leak private user memory into agency memory.
- Never leak one agency's information to another agency.
- Always enforce strict agency_id isolation.

Memory behavior:
- Maintain one rolling memory per scope instead of endlessly appending new memories.
- Prefer updating, merging, or deleting stale information over duplicating it.
- Keep durable facts, preferences, workflows, decisions, and active project context.
- Remove stale or irrelevant details after they stop being useful.
- Conversation refresh should feel invisible to the user.

Product behavior:
- Docs are heavily prioritized but not exclusive.
- Schedule/to-do/calendar extraction should turn actionable items from docs into tasks/events when enabled by plan.
- Notifications should support reminders, extracted tasks/events, and proactive follow-up.
- Spreadsheet AI is a paid feature.
- Corporation tier includes Gmail-like email workflows with AI assistance.
- Outreach should focus on usable, verified contact information and avoid low-confidence contacts.

Response style:
- Be helpful, direct, and task-oriented.
- Keep answers grounded in available evidence.
- Ask fewer unnecessary clarifying questions when enough context exists.
- For internal questions without evidence, say no supporting agency knowledge was found instead of hallucinating.
`.trim();
}

export async function ensureMemoryStoreSchema(db: Db) {
  await db.run(`
    CREATE TABLE IF NOT EXISTS memory_store (
      id TEXT PRIMARY KEY,
      memory_key TEXT NOT NULL UNIQUE,
      scope TEXT NOT NULL,
      agency_id TEXT,
      user_id TEXT,
      bot_id TEXT,
      content TEXT NOT NULL DEFAULT '',
      last_used_at TEXT,
      last_updated_at TEXT,
      created_at TEXT NOT NULL
    )
  `);

  await db.run(`CREATE INDEX IF NOT EXISTS idx_memory_store_scope ON memory_store(scope)`);
  await db.run(`CREATE INDEX IF NOT EXISTS idx_memory_store_agency ON memory_store(agency_id)`);
  await db.run(`CREATE INDEX IF NOT EXISTS idx_memory_store_user ON memory_store(user_id)`);
  await db.run(`CREATE INDEX IF NOT EXISTS idx_memory_store_bot ON memory_store(bot_id)`);
}

function buildMemoryKey(args: {
  scope: "system" | "agency" | "user";
  agencyId: string;
  userId?: string | null;
  botId?: string | null;
}) {
  if (args.scope === "system") return "system";
  if (args.scope === "agency") return `agency:${args.agencyId}`;
  return `user:${args.agencyId}:${args.userId ?? "none"}:${args.botId ?? "none"}`;
}

async function getMemoryRow(db: Db, args: {
  scope: "system" | "agency" | "user";
  agencyId: string;
  userId?: string | null;
  botId?: string | null;
}) {
  const memoryKey = buildMemoryKey(args);

  const row = (await db.get(
    `SELECT id, memory_key, scope, agency_id, user_id, bot_id, content
     FROM memory_store
     WHERE memory_key = ?
     LIMIT 1`,
    memoryKey
  )) as
    | {
        id?: string;
        memory_key?: string;
        scope?: string;
        agency_id?: string | null;
        user_id?: string | null;
        bot_id?: string | null;
        content?: string | null;
      }
    | undefined;

  if (row?.id) {
    await db.run(
      `UPDATE memory_store
       SET last_used_at = ?
       WHERE id = ?`,
      nowIso(),
      row.id
    );
    return {
      id: String(row.id),
      content: compact(row.content),
    };
  }

  const initialContent = args.scope === "system" ? canonicalSystemMemory() : "";

  const id = makeId("mem");
  await db.run(
    `INSERT INTO memory_store
     (id, memory_key, scope, agency_id, user_id, bot_id, content, last_used_at, last_updated_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    memoryKey,
    args.scope,
    args.scope === "system" ? null : args.agencyId,
    args.scope === "user" ? args.userId ?? null : null,
    args.scope === "user" ? args.botId ?? null : null,
    initialContent,
    nowIso(),
    nowIso(),
    nowIso()
  );

  return {
    id,
    content: initialContent,
  };
}

export async function buildChatMemoryContext(db: Db, args: {
  agencyId: string;
  userId: string;
  botId: string;
  conversationSummary?: string | null;
}) {
  await ensureMemoryStoreSchema(db);

  const system = await getMemoryRow(db, {
    scope: "system",
    agencyId: args.agencyId,
  });

  const agency = await getMemoryRow(db, {
    scope: "agency",
    agencyId: args.agencyId,
  });

  const user = await getMemoryRow(db, {
    scope: "user",
    agencyId: args.agencyId,
    userId: args.userId,
    botId: args.botId,
  });

  const parts: string[] = [];

  if (compact(system.content)) {
    parts.push(`[SYSTEM MEMORY]\n${compact(system.content)}`);
  }

  if (compact(agency.content)) {
    parts.push(`[AGENCY MEMORY]\n${compact(agency.content)}`);
  }

  if (compact(user.content)) {
    parts.push(`[USER MEMORY]\n${compact(user.content)}`);
  }

  if (compact(args.conversationSummary)) {
    parts.push(`[CONVERSATION MEMORY]\n${compact(args.conversationSummary)}`);
  }

  return {
    systemMemory: compact(system.content),
    agencyMemory: compact(agency.content),
    userMemory: compact(user.content),
    compiledMemory: parts.join("\n\n").trim(),
  };
}

async function rewriteRollingMemory(args: {
  scope: "agency" | "user";
  currentMemory: string;
  latestUserMessage: string;
  latestAssistantMessage: string;
  priorConversationSummary?: string | null;
}) {
  const resp = await openai.responses.create({
    model: "gpt-4.1-mini",
    input: `
You are updating a rolling memory string for Louis.Ai.

Goal:
- Maintain ONE clean, consistent memory string for this scope.
- Update existing memory instead of appending duplicates.
- Merge overlapping facts.
- Remove stale, irrelevant, superseded, or one-off details.
- Keep only durable, useful information.

Scope:
${args.scope.toUpperCase()}

Keep:
- durable preferences
- stable facts
- recurring workflows
- ongoing project context
- repeated habits
- active constraints
- named entities that matter later

Remove:
- temporary one-off details
- stale blockers
- outdated experiments
- superseded instructions
- low-value repetition

Rules:
- Output plain text only.
- Do not use JSON.
- Do not add headings other than these exact ones:
FACTS:
PREFERENCES:
WORKFLOWS:
ACTIVE CONTEXT:
REMOVE/IGNORE:
- Keep it compact.
- If nothing durable should be stored, keep the section minimal.
- Never invent facts.

CURRENT MEMORY:
${compact(args.currentMemory) || "(empty)"}

PRIOR CONVERSATION SUMMARY:
${compact(args.priorConversationSummary) || "(empty)"}

LATEST USER MESSAGE:
${compact(args.latestUserMessage)}

LATEST ASSISTANT MESSAGE:
${compact(args.latestAssistantMessage)}
`.trim(),
  });

  const text = compact(resp.output_text);
  return text.slice(0, 6000);
}

export async function updateRollingMemoriesAfterTurn(db: Db, args: {
  agencyId: string;
  userId: string;
  botId: string;
  userMessage: string;
  assistantMessage: string;
  conversationSummary?: string | null;
}) {
  await ensureMemoryStoreSchema(db);

  const agency = await getMemoryRow(db, {
    scope: "agency",
    agencyId: args.agencyId,
  });

  const user = await getMemoryRow(db, {
    scope: "user",
    agencyId: args.agencyId,
    userId: args.userId,
    botId: args.botId,
  });

  let nextAgency = compact(agency.content);
  let nextUser = compact(user.content);

  try {
    nextAgency = await rewriteRollingMemory({
      scope: "agency",
      currentMemory: agency.content,
      latestUserMessage: args.userMessage,
      latestAssistantMessage: args.assistantMessage,
      priorConversationSummary: args.conversationSummary,
    });
  } catch {
    nextAgency = compact(agency.content);
  }

  try {
    nextUser = await rewriteRollingMemory({
      scope: "user",
      currentMemory: user.content,
      latestUserMessage: args.userMessage,
      latestAssistantMessage: args.assistantMessage,
      priorConversationSummary: args.conversationSummary,
    });
  } catch {
    nextUser = compact(user.content);
  }

  await db.run(
    `UPDATE memory_store
     SET content = ?, last_used_at = ?, last_updated_at = ?
     WHERE id = ?`,
    nextAgency,
    nowIso(),
    nowIso(),
    agency.id
  );

  await db.run(
    `UPDATE memory_store
     SET content = ?, last_used_at = ?, last_updated_at = ?
     WHERE id = ?`,
    nextUser,
    nowIso(),
    nowIso(),
    user.id
  );
}