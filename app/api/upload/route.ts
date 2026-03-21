// app/api/upload/route.ts
import type { NextRequest } from "next/server";
import { getDb, type Db } from "@/lib/db";
import { openai } from "@/lib/openai";
import { requireActiveMember } from "@/lib/authz";
import { ensureSchema } from "@/lib/schema";
import { getPlanLimits, hasFeature, normalizePlan } from "@/lib/plans";
import { ensureUsageDailySchema, incrementUserUploads, getUserUsageRow } from "@/lib/usage";
import { enforceDailyUploads, getAgencyPlan } from "@/lib/enforcement";
import { getEffectiveTimezone, ymdInTz } from "@/lib/timezone";
import { createScheduleTask } from "@/app/api/schedule/tasks/route";
import { createScheduleEvent } from "@/app/api/schedule/events/route";
import { analyzeUploadedDocument, type DocumentRouteDecision } from "@/lib/document-routing";

export const runtime = "nodejs";

export async function OPTIONS() {
  return new Response(null, { status: 204 });
}

export async function GET() {
  return Response.json({ error: "METHOD_NOT_ALLOWED" }, { status: 405 });
}

function nowIso() {
  return new Date().toISOString();
}

function maxBytesForPlan(plan: string): number {
  const p = normalizePlan(plan);
  if (p === "free") return 25 * 1024 * 1024;
  if (p === "home") return 25 * 1024 * 1024;
  if (p === "pro") return 100 * 1024 * 1024;
  if (p === "enterprise") return 250 * 1024 * 1024;
  return 500 * 1024 * 1024;
}

function classifyMime(mime: string): "doc" | "image" | "video" | "other" {
  const m = String(mime || "").toLowerCase().trim();
  if (!m) return "other";
  if (m.startsWith("image/")) return "image";
  if (m.startsWith("video/")) return "video";
  if (m.startsWith("text/")) return "doc";
  if (m === "application/pdf") return "doc";
  if (m === "application/msword") return "doc";
  if (m.startsWith("application/vnd.openxmlformats-officedocument.")) return "doc";
  if (m.startsWith("application/vnd.ms-")) return "doc";
  if (m === "application/rtf") return "doc";
  if (m === "application/json") return "doc";
  if (m === "application/xml" || m === "text/xml") return "doc";
  if (m === "application/octet-stream") return "other";
  return "other";
}

type RouteDestination = "knowledge" | "schedule" | "spreadsheets" | "outreach" | "email" | "clarify";

type RouteDecision = {
  destination: RouteDestination;
  confidence: "high" | "medium" | "low";
  reason: string;
  asks_clarification: boolean;
  suggested_question: string | null;
  schedule_kind?: "task" | "event" | null;
};

type AutoCreatedResult =
  | {
      type: "task";
      id: string;
      title: string;
      due_at: string | null;
    }
  | {
      type: "event";
      id: string;
      title: string;
      start_at: string;
      end_at: string | null;
    }
  | null;

function isFileLike(v: any): v is File {
  return v && typeof v === "object" && typeof v.name === "string" && typeof v.arrayBuffer === "function";
}

function toUiDailyUploadsLimit(raw: unknown): number | null {
  const n = typeof raw === "number" ? raw : raw == null ? null : Number(raw);
  if (n == null || !Number.isFinite(n)) return null;
  if (n <= 0) return null;
  if (n >= 90000) return null;
  return Math.floor(n);
}

async function ensureOnboardingColumns(db: Db) {
  const columns = (await db.all(`PRAGMA table_info(users)`)) as Array<{ name?: string }>;
  const hasUploadedFirstDoc = columns.some((c) => c?.name === "uploaded_first_doc");

  if (!hasUploadedFirstDoc) {
    await db.run(`ALTER TABLE users ADD COLUMN uploaded_first_doc INTEGER NOT NULL DEFAULT 0`);
  }
}

async function markUploadedFirstDoc(db: Db, userId: string) {
  await ensureOnboardingColumns(db);
  await db.run(`UPDATE users SET uploaded_first_doc = 1 WHERE id = ?`, userId);
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
    `SELECT id, name, vector_store_id, owner_user_id, agency_id
     FROM bots
     WHERE id = ? AND agency_id = ?
       AND (owner_user_id IS NULL OR owner_user_id = ?)
     LIMIT 1`,
    args.bot_id,
    args.agency_id,
    args.user_id
  )) as
    | { id: string; name: string; vector_store_id: string | null; owner_user_id: string | null; agency_id: string }
    | undefined;

  if (!bot?.id) return { ok: false as const, error: "BOT_NOT_FOUND" as const };

  if (!bot.vector_store_id) {
    return { ok: false as const, error: "BOT_VECTOR_STORE_MISSING" as const, bot_id: bot.id };
  }

  return { ok: true as const, bot, vector_store_id: bot.vector_store_id };
}

async function readUploadedFileText(fileId: string) {
  try {
    const content = await openai.files.content(fileId);
    const text = await content.text();
    return String(text || "").trim();
  } catch {
    return "";
  }
}

function mapDecision(decision: DocumentRouteDecision): RouteDecision {
  return {
    destination: decision.destination,
    confidence: decision.confidence,
    reason: decision.why,
    asks_clarification: decision.asks_clarification,
    suggested_question: decision.clarification_question,
    schedule_kind: decision.schedule_kind,
  };
}

async function maybeAutoCreateScheduleItems(args: {
  db: Db;
  agencyId: string;
  userId: string;
  botId: string;
  timezone: string;
  filename: string;
  decision: DocumentRouteDecision;
}) {
  const created: AutoCreatedResult[] = [];

  if (args.decision.destination !== "schedule") return created;
  if (args.decision.confidence !== "high") return created;

  for (const task of args.decision.task_candidates || []) {
    if (!task.title) continue;

    const saved = await createScheduleTask({
      db: args.db,
      agencyId: args.agencyId,
      userId: args.userId,
      botId: args.botId,
      title: task.title,
      dueAt: task.due_at ?? null,
      notes: task.notes || `Auto-created from uploaded file: ${args.filename}`,
      timezone: args.timezone,
    });

    created.push({
      type: "task",
      id: saved.id,
      title: saved.title,
      due_at: saved.due_at,
    });
  }

  for (const event of args.decision.event_candidates || []) {
    if (!event.title || !event.start_at) continue;

    const saved = await createScheduleEvent({
      db: args.db,
      agencyId: args.agencyId,
      userId: args.userId,
      botId: args.botId,
      title: event.title,
      startAt: event.start_at,
      endAt: event.end_at ?? null,
      location: event.location ?? null,
      notes: event.notes || `Auto-created from uploaded file: ${args.filename}`,
      timezone: args.timezone,
    });

    created.push({
      type: "event",
      id: saved.id,
      title: saved.title,
      start_at: saved.start_at,
      end_at: saved.end_at,
    });
  }

  return created;
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireActiveMember(req);

    const db: Db = await getDb();
    await ensureSchema(db);
    await ensureUsageDailySchema(db);
    await ensureOnboardingColumns(db);

    const tz = await getEffectiveTimezone(db, {
      agencyId: ctx.agencyId,
      userId: ctx.userId,
      headers: req.headers,
    });

    const now = new Date();
    const dateKey = ymdInTz(now, tz);

    const plan = await getAgencyPlan(db, ctx.agencyId, ctx.plan);
    const planKey = normalizePlan(plan);
    const limits = getPlanLimits(planKey);

    const allowMultimedia = hasFeature(planKey, "multimedia");
    const allowImages = allowMultimedia;
    const allowVideo = allowMultimedia;
    const allowOtherBinary = allowMultimedia;
    const maxBytes = maxBytesForPlan(planKey);

    const form = await req.formData();

    const rawA = form.getAll("files");
    const rawB = form.getAll("file");
    const files = [...rawA, ...rawB].filter(isFileLike) as File[];

    if (!files.length) {
      const keys: string[] = [];
      try {
        for (const [k] of (form as any).entries?.() ?? []) keys.push(String(k));
      } catch {}
      return Response.json(
        {
          ok: false,
          error: "No files uploaded",
          hint: "Expected multipart field name 'files' (multiple) or 'file' (single).",
          received_fields: Array.from(new Set(keys)).slice(0, 50),
        },
        { status: 400 }
      );
    }

    const uploadsGate = await enforceDailyUploads(db, ctx.agencyId, ctx.userId, dateKey, planKey, files.length);
    if (!uploadsGate.ok) {
      return Response.json({ ...uploadsGate.body, timezone: tz }, { status: uploadsGate.status });
    }

    for (const file of files) {
      const size = Number((file as any).size ?? 0);
      if (!Number.isFinite(size) || size <= 0) {
        return Response.json({ ok: false, error: "INVALID_FILE" }, { status: 400 });
      }

      if (size > maxBytes) {
        return Response.json(
          {
            ok: false,
            error: "FILE_TOO_LARGE",
            message: `File exceeds size limit for plan '${planKey}'.`,
            plan: planKey,
            maxBytes,
            file: { name: file.name, size },
          },
          { status: 413 }
        );
      }

      const mime = String((file as any).type ?? "");
      const kind = classifyMime(mime);

      if (kind === "image" && !allowImages) {
        return Response.json(
          {
            ok: false,
            error: "MIME_NOT_ALLOWED",
            message: `Images are not allowed on plan '${planKey}'.`,
            plan: planKey,
            file: { name: file.name, type: mime, kind },
          },
          { status: 415 }
        );
      }

      if (kind === "video" && !allowVideo) {
        return Response.json(
          {
            ok: false,
            error: "MIME_NOT_ALLOWED",
            message: `Video is not allowed on plan '${planKey}'.`,
            plan: planKey,
            file: { name: file.name, type: mime, kind },
          },
          { status: 415 }
        );
      }

      if (kind === "other" && !allowOtherBinary) {
        return Response.json(
          {
            ok: false,
            error: "MIME_NOT_ALLOWED",
            message: `This file type is not allowed on plan '${planKey}'.`,
            plan: planKey,
            file: { name: file.name, type: mime, kind },
          },
          { status: 415 }
        );
      }

      if ((planKey === "free" || planKey === "home") && kind === "other") {
        return Response.json(
          {
            ok: false,
            error: "MIME_NOT_ALLOWED",
            message: `This file type is not allowed on plan '${planKey}'.`,
            plan: planKey,
            file: { name: file.name, type: mime, kind },
          },
          { status: 415 }
        );
      }
    }

    let bot_id = String(form.get("bot_id") ?? "").trim();
    if (!bot_id) {
      const fallback = await getFallbackBotId(db, ctx.agencyId, ctx.userId);
      if (!fallback) {
        return Response.json({ ok: false, error: "No bots found for this agency/user" }, { status: 404 });
      }
      bot_id = fallback;
    }

    const ensured = await assertBotAccessAndGetVectorStore(db, {
      bot_id,
      agency_id: ctx.agencyId,
      user_id: ctx.userId,
    });

    if (!ensured.ok) {
      if (ensured.error === "BOT_VECTOR_STORE_MISSING") {
        return Response.json(
          {
            ok: false,
            error: "This bot can’t accept uploads yet (vector store missing).",
            code: "BOT_VECTOR_STORE_MISSING",
            bot_id,
          },
          { status: 409 }
        );
      }
      return Response.json({ ok: false, error: "Bot not found" }, { status: 404 });
    }

    const vectorStoreId = ensured.vector_store_id;

    const uploaded: Array<{
      document_id: string;
      filename: string;
      openai_file_id: string;
      route: RouteDecision;
      auto_created: AutoCreatedResult[];
      extracted_text_preview: string;
    }> = [];

    for (const file of files) {
      const uploadedFile = await openai.files.create({ file, purpose: "assistants" });

      const vsFile = await openai.vectorStores.files.create(vectorStoreId, { file_id: uploadedFile.id });

      const start = Date.now();
      while (true) {
        const cur = await openai.vectorStores.files.retrieve(vsFile.id, { vector_store_id: vectorStoreId });
        if (cur.status === "completed") break;
        if (cur.status === "failed") throw new Error(`Indexing failed for ${file.name}`);
        if (Date.now() - start > 120_000) throw new Error(`Indexing timed out for ${file.name}`);
        await new Promise((r) => setTimeout(r, 1500));
      }

      const created_at = nowIso();

      await db.run(
        `INSERT INTO documents (id, agency_id, bot_id, title, mime_type, bytes, openai_file_id, created_at)
         VALUES (lower(hex(randomblob(16))), ?, ?, ?, ?, ?, ?, ?)`,
        ctx.agencyId,
        bot_id,
        file.name,
        file.type || null,
        (file as any).size ?? 0,
        uploadedFile.id,
        created_at
      );

      const row = (await db.get(
        `SELECT id
         FROM documents
         WHERE agency_id = ? AND bot_id = ? AND openai_file_id = ?
         ORDER BY created_at DESC
         LIMIT 1`,
        ctx.agencyId,
        bot_id,
        uploadedFile.id
      )) as { id: string } | undefined;

      const extractedText = await readUploadedFileText(uploadedFile.id);

      const decision = await analyzeUploadedDocument({
        filename: file.name,
        mime: file.type || "",
        text: extractedText,
        timezone: tz,
      });

      const auto_created = await maybeAutoCreateScheduleItems({
        db,
        agencyId: ctx.agencyId,
        userId: ctx.userId,
        botId: bot_id,
        timezone: tz,
        filename: file.name,
        decision,
      });

      uploaded.push({
        document_id: row?.id ?? "",
        filename: file.name,
        openai_file_id: uploadedFile.id,
        route: mapDecision(decision),
        auto_created,
        extracted_text_preview: extractedText.slice(0, 280),
      });
    }

    await markUploadedFirstDoc(db, ctx.userId);

    await incrementUserUploads(db, ctx.agencyId, ctx.userId, dateKey, files.length);
    const usageRow = await getUserUsageRow(db, ctx.agencyId, ctx.userId, dateKey);

    const needsClarification = uploaded.some((x) => x.route.asks_clarification);

    const routedCounts = uploaded.reduce<Record<RouteDestination, number>>(
      (acc, item) => {
        acc[item.route.destination] = (acc[item.route.destination] || 0) + 1;
        return acc;
      },
      {
        knowledge: 0,
        schedule: 0,
        spreadsheets: 0,
        outreach: 0,
        email: 0,
        clarify: 0,
      }
    );

    const autoCreatedSummary = uploaded.reduce(
      (acc, item) => {
        for (const created of item.auto_created) {
          if (!created) continue;
          if (created.type === "task") acc.tasks += 1;
          if (created.type === "event") acc.events += 1;
        }
        return acc;
      },
      { tasks: 0, events: 0 }
    );

    return Response.json({
      ok: true,
      bot_id,
      uploaded,
      date: dateKey,
      timezone: tz,
      routing: {
        needs_clarification: needsClarification,
        summary: {
          knowledge: routedCounts.knowledge,
          schedule: routedCounts.schedule,
          spreadsheets: routedCounts.spreadsheets,
          outreach: routedCounts.outreach,
          email: routedCounts.email,
          clarify: routedCounts.clarify,
        },
        auto_created: autoCreatedSummary,
      },
      usage: {
        uploads_used: usageRow.uploads_count,
        daily_uploads_limit: toUiDailyUploadsLimit((limits as any)?.daily_uploads),
        plan: planKey,
      },
    });
  } catch (err: any) {
    const code = String(err?.code ?? err?.message ?? err);

    if (code === "UNAUTHENTICATED") return Response.json({ error: "Unauthorized" }, { status: 401 });
    if (code === "FORBIDDEN_NOT_ACTIVE") return Response.json({ error: "Forbidden" }, { status: 403 });

    console.error("UPLOAD_ERROR", err);

    const msg = String(err?.message || "");
    const isBilling =
      msg.toLowerCase().includes("quota") ||
      msg.toLowerCase().includes("billing") ||
      msg.toLowerCase().includes("payment") ||
      msg.includes("You exceeded your current quota") ||
      msg.includes("429");

    return Response.json(
      { ok: false, error: isBilling ? "OpenAI billing/quota required to upload documents" : "Server error", message: msg },
      { status: isBilling ? 402 : 500 }
    );
  }
}