// app/api/chat/route.ts
import { type NextRequest } from "next/server";
import { getDb, type Db } from "@/lib/db";
import { requireActiveMember } from "@/lib/authz";
import { normalizePlan, getPlanLimits } from "@/lib/plans";
import { openai } from "@/lib/openai";
import { ensureSchema } from "@/lib/schema";
import { ensureUsageDailySchema, incrementUserMessages, getUserUsageRow } from "@/lib/usage";
import { enforceDailyMessages, getAgencyPlan } from "@/lib/enforcement";
import { getEffectiveTimezone, ymdInTz, timeStringInTz } from "@/lib/timezone";
import { buildChatMemoryContext, ensureMemoryStoreSchema, updateRollingMemoriesAfterTurn } from "@/lib/chat-memory";
import { decayScopeMemories } from "@/lib/memory-decay";
import { getVideoContextForAttachments } from "@/lib/video-extract";

export const runtime = "nodejs";

const FALLBACK = "I don’t have that information in the docs yet.";

type ChatBody = {
  bot_id?: string;
  message?: string;
  attachments?: string[];
  attachment_ids?: string[];
  document_ids?: string[];
  file_ids?: string[];
};

type ResolvedImage = {
  openai_file_id: string;
  title: string;
};

type ResolvedInputFile = {
  openai_file_id: string;
  title: string;
  mime_type: string;
};

function summarizeThresholdForPlan(plan: string | null) {
  const p = String(plan ?? "free").toLowerCase();
  if (p === "free") return 20;
  if (p === "home") return 30;
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

function looksLikePdfGenerationRequest(s: string) {
  const t = String(s || "").trim().toLowerCase();
  if (!t) return false;

  const pdfTerms = [
    "pdf",
    "export pdf",
    "make a pdf",
    "create a pdf",
    "generate a pdf",
    "turn this into a pdf",
    "save as pdf",
    "downloadable pdf",
  ];

  return pdfTerms.some((term) => t.includes(term));
}

function sanitizePdfFilename(name: string) {
  const safe = String(name || "")
    .replace(/[^a-zA-Z0-9-_ ]+/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
  return safe || "louis-chat-export";
}

function buildPdfTitleFromMessage(message: string, botName?: string | null) {
  const raw = String(message || "").trim();
  const cleaned = raw
    .replace(/\b(create|make|generate|export|turn|save|download)\b/gi, "")
    .replace(/\b(a|an|as|to|this|into|me)\b/gi, "")
    .replace(/\bpdf\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();

  if (cleaned) {
    return cleaned.length > 90 ? `${cleaned.slice(0, 90).trim()}...` : cleaned;
  }

  return botName ? `${botName} PDF` : "Louis PDF";
}

async function ensureOnboardingColumns(db: Db) {
  const columns = (await db.all(`PRAGMA table_info(users)`)) as Array<{ name?: string }>;
  const hasSentFirstChat = columns.some((c) => c?.name === "sent_first_chat");

  if (!hasSentFirstChat) {
    await db.run(`ALTER TABLE users ADD COLUMN sent_first_chat INTEGER NOT NULL DEFAULT 0`);
  }
}

async function markSentFirstChat(db: Db, userId: string) {
  await ensureOnboardingColumns(db);
  await db.run(`UPDATE users SET sent_first_chat = 1 WHERE id = ?`, userId);
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
    "what are ",
    "who is ",
    "where is ",
    "tell me about ",
    "what's ",
    "whats ",
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

function buildMemoryInput(args: {
  compiledMemory: string;
  messages: Array<{ role: string; content: string }>;
}) {
  const parts: string[] = [];

  if (args.compiledMemory && args.compiledMemory.trim().length) {
    parts.push(
      `[ROLLING MEMORY — DO NOT IGNORE]

This is the persistent rolling memory context for Louis.Ai.
Treat it as authoritative unless the latest evidence clearly overrides it.

${args.compiledMemory.trim()}
`
    );
  }

  for (const m of args.messages) {
    parts.push(`${m.role.toUpperCase()}: ${m.content}`);
  }

  return parts.join("\n");
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

function isPdfMime(mime: string) {
  return mime === "application/pdf";
}

function isImageMime(mime: string) {
  return mime.startsWith("image/");
}

function isVideoMime(mime: string) {
  return mime.startsWith("video/");
}

function isDirectInputFileMime(mime: string) {
  return (
    isPdfMime(mime) ||
    mime === "text/plain" ||
    mime === "text/markdown" ||
    mime === "application/json" ||
    mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    mime === "application/msword" ||
    mime === "application/vnd.openxmlformats-officedocument.presentationml.presentation" ||
    mime === "application/vnd.ms-powerpoint"
  );
}

async function resolveAttachments(db: Db, args: { agencyId: string; botId: string; ids: string[] }) {
  const unique = Array.from(
    new Set(
      (args.ids || [])
        .map((x) => String(x || "").trim())
        .filter(Boolean)
        .slice(0, 8)
    )
  );

  if (!unique.length) {
    return {
      images: [] as ResolvedImage[],
      inputFiles: [] as ResolvedInputFile[],
      videos: [] as string[],
    };
  }

  const images: ResolvedImage[] = [];
  const inputFiles: ResolvedInputFile[] = [];
  const videos: string[] = [];

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
    )) as
      | {
          id?: string;
          title?: string | null;
          mime_type?: string | null;
          openai_file_id?: string | null;
        }
      | undefined;

    if (!row?.openai_file_id) continue;

    const mime = String(row.mime_type ?? "").toLowerCase();
    const title = String(row.title ?? "file");

    if (isImageMime(mime)) {
      images.push({
        openai_file_id: String(row.openai_file_id),
        title,
      });
      continue;
    }

    if (isVideoMime(mime)) {
      videos.push(title);
      continue;
    }

    if (isDirectInputFileMime(mime)) {
      inputFiles.push({
        openai_file_id: String(row.openai_file_id),
        title,
        mime_type: mime,
      });
    }
  }

  return { images, inputFiles, videos };
}

function looksLikeDocAbsenceClaim(text: string) {
  const t = String(text || "").toLowerCase();
  if (!t.trim()) return true;

  const badPhrases = [
    "no information",
    "not in the documents",
    "not in the uploaded",
    "documents you provided",
    "uploaded files",
    "provided files",
    "i don't have specific details on it",
    "i do not have specific details on it",
    "based on general knowledge",
    "if you can provide more context",
    "would you like me to look it up on the web",
  ];

  return badPhrases.some((p) => t.includes(p));
}

function buildVideoContextBlock(
  rows: Array<{
    document_id: string;
    transcript: string;
    frames_summary: string;
    video_summary: string;
    status: string;
  }>
) {
  const usable = rows.filter((r) => {
    return !!String(r.video_summary || r.transcript || r.frames_summary || "").trim();
  });

  if (!usable.length) return "";

  return usable
    .map((row, idx) => {
      const parts: string[] = [];
      if (row.video_summary) parts.push(`Summary: ${row.video_summary}`);
      if (row.frames_summary) parts.push(`Frames: ${row.frames_summary}`);
      if (row.transcript) parts.push(`Transcript: ${row.transcript}`);
      return `[VIDEO CONTEXT ${idx + 1}]\nStatus: ${row.status || "unknown"}\n${parts.join("\n")}`;
    })
    .join("\n\n");
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
    await ensureOnboardingColumns(db);
    await ensureMemoryStoreSchema(db);

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

    const gate = await enforceDailyMessages(db, ctx.agencyId, ctx.userId, dateKey, plan);
    if (!gate.ok) return Response.json(gate.body, { status: gate.status });

    const bot = (await db.get(
      `SELECT id, name, vector_store_id
       FROM bots
       WHERE id = ? AND agency_id = ?
         AND (owner_user_id IS NULL OR owner_user_id = ?)
       LIMIT 1`,
      bot_id,
      ctx.agencyId,
      ctx.userId
    )) as { id?: string; name?: string | null; vector_store_id?: string | null } | undefined;

    if (!bot?.id) return Response.json({ error: "Bot not found" }, { status: 404 });

    const rawAttach =
      (Array.isArray(body?.attachments) ? body.attachments : null) ??
      (Array.isArray(body?.attachment_ids) ? body.attachment_ids : null) ??
      (Array.isArray(body?.document_ids) ? body.document_ids : null) ??
      (Array.isArray(body?.file_ids) ? body.file_ids : null) ??
      [];

    const { images: imageFiles, inputFiles, videos: videoTitles } = await resolveAttachments(db, {
      agencyId: ctx.agencyId,
      botId: bot_id,
      ids: rawAttach,
    });

    const videoContextRows = await getVideoContextForAttachments(db, {
      agencyId: ctx.agencyId,
      botId: bot_id,
      documentIds: rawAttach,
    });

    const videoContextBlock = buildVideoContextBlock(videoContextRows);

    const convo = await getOrCreateConversation(db, {
      agencyId: ctx.agencyId,
      userId: ctx.userId,
      botId: bot_id,
    });

    const pdfRequested = looksLikePdfGenerationRequest(message);
    const pdfTitles = inputFiles.filter((f) => isPdfMime(f.mime_type)).map((f) => f.title);
    const docTitles = inputFiles.filter((f) => !isPdfMime(f.mime_type)).map((f) => f.title);

    const attachLines: string[] = [];
    if (imageFiles.length) attachLines.push(`Images: ${imageFiles.map((x) => x.title).join(", ")}`);
    if (pdfTitles.length) attachLines.push(`PDFs: ${pdfTitles.join(", ")}`);
    if (docTitles.length) attachLines.push(`Files: ${docTitles.join(", ")}`);
    if (videoTitles.length) attachLines.push(`Videos: ${videoTitles.join(", ")}`);
    if (videoContextBlock) attachLines.push(`Video extraction: available`);

    const attachNote = attachLines.length ? `\n\n[Attachments]\n${attachLines.join("\n")}\n` : "";

    await insertMessage(db, convo.id, "user", message + attachNote);

    const recent = await loadRecentMessages(db, convo.id, 20);

    const memoryContext = await buildChatMemoryContext(db, {
      agencyId: ctx.agencyId,
      userId: ctx.userId,
      botId: bot_id,
      conversationSummary: convo.summary,
    });

    let openaiInputText = buildMemoryInput({
      compiledMemory: memoryContext.compiledMemory,
      messages: recent,
    });

    if (videoContextBlock) {
      openaiInputText += `

[EXTRACTED VIDEO CONTEXT — USE WHEN RELEVANT]
${videoContextBlock}
`;
    }

    let answer = "";
    let pdfReady = false;
    let pdfTitle = "";
    let pdfFilename = "";
    let pdfText = "";

    if (looksLikeTimeQuestion(message)) {
      answer = timeStringInTz(now, tz);
    } else {
      const internal = looksInternalBusinessQuestion(message);

      const hasImages = imageFiles.length > 0;
      const hasInputFiles = inputFiles.length > 0;
      const hasPdfs = pdfTitles.length > 0;
      const hasVideos = videoTitles.length > 0;
      const hasVideoContext = !!videoContextBlock.trim();
      const hasRollingMemory = !!String(memoryContext.compiledMemory || "").trim();

      const mediaHintParts: string[] = [];

      if (hasImages) {
        mediaHintParts.push("The user attached one or more images. Analyze them directly when relevant.");
      }

      if (hasPdfs) {
        mediaHintParts.push("The user attached one or more PDFs. Read them directly when relevant.");
      }

      if (hasInputFiles && !hasPdfs) {
        mediaHintParts.push("The user attached one or more files. Read them directly when relevant.");
      }

      if (hasVideos && hasVideoContext) {
        mediaHintParts.push(
          "The user attached one or more videos and extracted video context is available below. Use the video transcript, frame summary, and video summary as grounded support."
        );
      } else if (hasVideos) {
        mediaHintParts.push(
          "The user attached one or more videos. Direct raw video reasoning is not enabled, so be honest about that and use any extracted video context if present, plus filenames and surrounding context."
        );
      }

      if (!mediaHintParts.length) {
        mediaHintParts.push("If the user asks about the contents of an image, PDF, file, or video, be honest about limitations.");
      }

      const mediaHint = mediaHintParts.join(" ");

      const toolsAttempt1 =
        internal && bot.vector_store_id
          ? [{ type: "file_search" as const, vector_store_ids: [bot.vector_store_id] }]
          : [];

      const pdfInstruction = pdfRequested
        ? `
PDF MODE:
- The user wants a real downloadable PDF.
- Do NOT say things like "I will create a PDF", "I can create a PDF", or "here is the finalized text I will include".
- Instead, write ONLY the final PDF body content itself.
- No preamble.
- No markdown fences.
- No commentary about downloading.
- Make it clean and presentation-ready.
`
        : "";

      const fallbackInstruction = internal
        ? `If the question is internal/business, prefer file_search first when available.
If file_search finds relevant evidence, use it.
If file_search does NOT find relevant evidence, you may still answer from attached images, attached PDFs/files, extracted video context, or rolling memory when those provide enough grounded support.
Only reply exactly with this fallback when there is truly not enough grounded support from docs, attached inputs, extracted video context, or rolling memory:
${FALLBACK}`
        : `This is NOT an internal/business question. Answer normally using general knowledge and reasoning.
You MAY use web_search for up-to-date facts.
Do NOT mention uploaded documents/files unless the user explicitly asked about their uploaded documents or attached files.
Do NOT use this exact sentence in your reply: ${FALLBACK}`;

      const inputContent: any[] = [{ type: "input_text", text: openaiInputText }];

      for (const img of imageFiles) {
        inputContent.push({
          type: "input_image",
          image_file_id: img.openai_file_id,
        });
      }

      for (const file of inputFiles) {
        inputContent.push({
          type: "input_file",
          file_id: file.openai_file_id,
        });
      }

      const inputBlocks: any[] = [
        {
          role: "user",
          content: inputContent,
        },
      ];

      const resp1 = await openai.responses.create({
        model: "gpt-4.1-mini",
        instructions: `
You are Louis.Ai.

Behavior:
- Use the rolling memory provided in the conversation input as persistent context.
- If the question is internal/business related to the user's organization, prefer uploaded docs via file_search first when available, but do NOT behave as docs-only.
- You may answer internal questions from attached images, attached PDFs/files, extracted video context, or rolling memory when they provide enough grounded support.
- If the question is NOT internal, answer normally using general knowledge and reasoning.
- Never fabricate internal/company-specific details.
- ${mediaHint}
- ${fallbackInstruction}
${pdfInstruction}
`.trim(),
        input: inputBlocks,
        tools: toolsAttempt1,
      });

      const modelText1 =
        typeof resp1.output_text === "string" && resp1.output_text.trim().length > 0 ? resp1.output_text.trim() : "";

      const hasEvidence1 = toolsAttempt1.length > 0 ? responseHasFileSearchEvidence(resp1) : false;
      const hasDirectGrounding = hasImages || hasInputFiles || hasVideoContext;
      const hasAnyGrounding = hasEvidence1 || hasDirectGrounding || hasRollingMemory;
      const modelLooksGrounded = !!modelText1 && modelText1 !== FALLBACK && !looksLikeDocAbsenceClaim(modelText1);

      if (internal) {
        if (hasEvidence1) {
          answer = modelText1 || FALLBACK;
        } else if (hasAnyGrounding && modelLooksGrounded) {
          answer = modelText1;
        } else {
          answer = FALLBACK;
        }
      } else {
        const needsRetry = looksLikeDocAbsenceClaim(modelText1) || modelText1 === FALLBACK;

        if (!needsRetry) {
          answer = modelText1 || "Sorry — I couldn’t generate a response.";
        } else {
          const resp2 = await openai.responses.create({
            model: "gpt-4.1-mini",
            instructions: `
You are Louis.Ai.

Behavior:
- Use the rolling memory provided in the conversation input as persistent context.
- This is NOT an internal/business question. Answer normally using general knowledge and reasoning.
- You MAY use web_search for up-to-date facts.
- Do NOT mention uploaded documents/files unless the user explicitly asked about their uploaded documents or attached files.
- Do NOT use this exact sentence in your reply: ${FALLBACK}
- Be direct. No questions like "Would you like me to look it up?" — just answer.
${pdfInstruction}

${mediaHint}
`.trim(),
            input: inputBlocks,
            tools: [{ type: "web_search_preview" as const }],
          });

          const modelText2 =
            typeof resp2.output_text === "string" && resp2.output_text.trim().length > 0 ? resp2.output_text.trim() : "";

          answer = modelText2 && modelText2 !== FALLBACK ? modelText2 : "Sorry — I couldn’t generate a response.";
        }
      }

      if (pdfRequested && answer && answer !== FALLBACK && !answer.toLowerCase().includes("i will create a pdf")) {
        pdfReady = true;
        pdfTitle = buildPdfTitleFromMessage(message, bot.name ?? null);
        pdfFilename = sanitizePdfFilename(pdfTitle);
        pdfText = answer;
        answer = `Your PDF is ready. The download should start automatically.`;
      }
    }

    await insertMessage(db, convo.id, "assistant", answer);
    await markSentFirstChat(db, ctx.userId);

    await updateRollingMemoriesAfterTurn(db, {
      agencyId: ctx.agencyId,
      userId: ctx.userId,
      botId: bot_id,
      userMessage: message + attachNote,
      assistantMessage: answer,
      conversationSummary: convo.summary ?? null,
    });

    await decayScopeMemories(db, {
      agencyId: ctx.agencyId,
      userId: ctx.userId,
      botId: bot_id,
      agencyStaleAfterDays: 21,
      userStaleAfterDays: 14,
      agencyMaxLen: 5500,
      userMaxLen: 4500,
    });

    await incrementUserMessages(db, ctx.agencyId, ctx.userId, dateKey, 1);
    const usageAfter = await getUserUsageRow(db, ctx.agencyId, ctx.userId, dateKey);

    await db.run(
      `UPDATE conversations
       SET message_count = COALESCE(message_count, 0) + 2,
           updated_at = ?
       WHERE id = ?`,
      nowIso(),
      convo.id
    );

    const planKey = normalizePlan(plan);
    const threshold = summarizeThresholdForPlan(planKey);

    const convoRow = (await db.get(
      `SELECT summary, message_count
       FROM conversations
       WHERE id = ?
       LIMIT 1`,
      convo.id
    )) as { summary?: string | null; message_count?: number | null } | undefined;

    const currentCount = Number(convoRow?.message_count ?? 0);

    if (currentCount >= threshold) {
      const msgsForSummary = await loadRecentMessages(db, convo.id, 200);
      const memoryInput = buildMemoryInput({
        compiledMemory: memoryContext.compiledMemory,
        messages: msgsForSummary,
      });

      let nextSummary = "";
      try {
        nextSummary = await summarizeForMemory(memoryInput);
      } catch {
        nextSummary = "";
      }

      if (nextSummary && nextSummary.trim().length) {
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
        } catch {}
      }
    }

    const limits = getPlanLimits(planKey);
    const dailyLimitUi = toUiDailyLimit((limits as any)?.daily_messages);

    return Response.json({
      ok: true,
      answer,
      pdf_ready: pdfReady,
      pdf_title: pdfTitle || undefined,
      pdf_filename: pdfFilename || undefined,
      pdf_text: pdfText || undefined,
      usage: {
        used: Number(usageAfter.messages_count ?? 0),
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