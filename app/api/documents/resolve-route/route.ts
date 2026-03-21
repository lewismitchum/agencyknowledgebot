// app/api/documents/resolve-route/route.ts
import type { NextRequest } from "next/server";
import { getDb, type Db } from "@/lib/db";
import { requireActiveMember } from "@/lib/authz";
import { ensureSchema } from "@/lib/schema";
import { getEffectiveTimezone } from "@/lib/timezone";
import { openai } from "@/lib/openai";
import { analyzeUploadedDocument, type DocumentRouteDecision } from "@/lib/document-routing";
import { createScheduleTask } from "@/app/api/schedule/tasks/route";
import { createScheduleEvent } from "@/app/api/schedule/events/route";

export const runtime = "nodejs";

type ClarifyChoice = "knowledge" | "schedule" | "spreadsheets" | "outreach" | "email";

type RouteDestination = "knowledge" | "schedule" | "spreadsheets" | "outreach" | "email" | "clarify";

type RouteDecision = {
  destination: RouteDestination;
  confidence: "high" | "medium" | "low";
  reason: string;
  asks_clarification: boolean;
  suggested_question: string | null;
  schedule_kind?: "task" | "event" | null;
};

type AutoCreatedItem =
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
    };

function isChoice(v: unknown): v is ClarifyChoice {
  return v === "knowledge" || v === "schedule" || v === "spreadsheets" || v === "outreach" || v === "email";
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

async function assertBotAccess(db: Db, args: { bot_id: string; agency_id: string; user_id: string }) {
  const bot = (await db.get(
    `SELECT id, agency_id, owner_user_id
     FROM bots
     WHERE id = ?
     LIMIT 1`,
    args.bot_id
  )) as { id: string; agency_id: string; owner_user_id: string | null } | undefined;

  if (!bot?.id) {
    const e: any = new Error("BOT_NOT_FOUND");
    e.code = "BOT_NOT_FOUND";
    throw e;
  }

  if (bot.agency_id !== args.agency_id) {
    const e: any = new Error("FORBIDDEN_BOT");
    e.code = "FORBIDDEN_BOT";
    throw e;
  }

  if (bot.owner_user_id && bot.owner_user_id !== args.user_id) {
    const e: any = new Error("FORBIDDEN_BOT");
    e.code = "FORBIDDEN_BOT";
    throw e;
  }
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

async function createFromDecision(args: {
  db: Db;
  agencyId: string;
  userId: string;
  botId: string;
  timezone: string;
  filename: string;
  decision: DocumentRouteDecision;
}) {
  const created: AutoCreatedItem[] = [];

  if (args.decision.destination !== "schedule") return created;

  for (const task of args.decision.task_candidates || []) {
    if (!task.title) continue;

    const saved = await createScheduleTask({
      db: args.db,
      agencyId: args.agencyId,
      userId: args.userId,
      botId: args.botId,
      title: task.title,
      dueAt: task.due_at ?? null,
      notes: task.notes || `Created from resolved document: ${args.filename}`,
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
      notes: event.notes || `Created from resolved document: ${args.filename}`,
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

function forcedRouteFromChoice(choice: ClarifyChoice, base: DocumentRouteDecision): DocumentRouteDecision {
  if (choice === "knowledge") {
    return {
      ...base,
      destination: "knowledge",
      confidence: "medium",
      why: "Saved as knowledge by user choice.",
      asks_clarification: false,
      clarification_question: null,
    };
  }

  if (choice === "spreadsheets") {
    return {
      ...base,
      destination: "spreadsheets",
      confidence: "medium",
      why: "Sent to spreadsheets by user choice.",
      asks_clarification: false,
      clarification_question: null,
    };
  }

  if (choice === "outreach") {
    return {
      ...base,
      destination: "outreach",
      confidence: "medium",
      why: "Sent to outreach by user choice.",
      asks_clarification: false,
      clarification_question: null,
    };
  }

  if (choice === "email") {
    return {
      ...base,
      destination: "email",
      confidence: "medium",
      why: "Marked for email use by user choice.",
      asks_clarification: false,
      clarification_question: null,
    };
  }

  return {
    ...base,
    destination: "schedule",
    confidence: base.task_candidates.length || base.event_candidates.length ? "high" : "medium",
    why:
      base.task_candidates.length || base.event_candidates.length
        ? "Schedule items created from document after user confirmation."
        : "User chose schedule, but the document still needs more detail before items can be created.",
    asks_clarification: base.task_candidates.length || base.event_candidates.length ? false : true,
    clarification_question:
      base.task_candidates.length || base.event_candidates.length
        ? null
        : "I still need clearer task or event details in this document before I can create schedule items.",
  };
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireActiveMember(req);
    const db = await getDb();
    await ensureSchema(db);

    const body = (await req.json().catch(() => null)) as any;
    const document_id = String(body?.document_id ?? "").trim();
    const bot_id = String(body?.bot_id ?? "").trim();
    const choice = body?.choice;

    if (!document_id) {
      return Response.json({ ok: false, error: "DOCUMENT_ID_REQUIRED" }, { status: 400 });
    }

    if (!bot_id) {
      return Response.json({ ok: false, error: "BOT_ID_REQUIRED" }, { status: 400 });
    }

    if (!isChoice(choice)) {
      return Response.json({ ok: false, error: "BAD_CHOICE" }, { status: 400 });
    }

    await assertBotAccess(db, {
      bot_id,
      agency_id: ctx.agencyId,
      user_id: ctx.userId,
    });

    const doc = (await db.get(
      `SELECT id, agency_id, bot_id, title, mime_type, openai_file_id
       FROM documents
       WHERE id = ? AND agency_id = ? AND bot_id = ?
       LIMIT 1`,
      document_id,
      ctx.agencyId,
      bot_id
    )) as
      | {
          id: string;
          agency_id: string;
          bot_id: string;
          title: string | null;
          mime_type: string | null;
          openai_file_id: string | null;
        }
      | undefined;

    if (!doc?.id) {
      return Response.json({ ok: false, error: "DOCUMENT_NOT_FOUND" }, { status: 404 });
    }

    if (!doc.openai_file_id) {
      return Response.json({ ok: false, error: "DOCUMENT_FILE_MISSING" }, { status: 409 });
    }

    const tz = await getEffectiveTimezone(db, {
      agencyId: ctx.agencyId,
      userId: ctx.userId,
      headers: req.headers,
    });

    const extractedText = await readUploadedFileText(doc.openai_file_id);

    const analyzed = await analyzeUploadedDocument({
      filename: String(doc.title || "document"),
      mime: String(doc.mime_type || ""),
      text: extractedText,
      timezone: tz,
    });

    const decision = forcedRouteFromChoice(choice, analyzed);
    const auto_created = await createFromDecision({
      db,
      agencyId: ctx.agencyId,
      userId: ctx.userId,
      botId: bot_id,
      timezone: tz,
      filename: String(doc.title || "document"),
      decision,
    });

    const finalDecision =
      choice === "schedule" && auto_created.length === 0
        ? {
            ...decision,
            asks_clarification: true,
            suggested_question:
              "I still could not find enough clear task or event details to create schedule items from this document.",
          }
        : {
            destination: decision.destination,
            confidence: decision.confidence,
            reason: decision.why,
            asks_clarification: decision.asks_clarification,
            suggested_question: decision.clarification_question,
            schedule_kind: decision.schedule_kind,
          };

    return Response.json({
      ok: true,
      item: {
        document_id: doc.id,
        filename: String(doc.title || "document"),
        route: finalDecision,
        auto_created,
        extracted_text_preview: extractedText.slice(0, 280),
      },
    });
  } catch (err: any) {
    const code = String(err?.code ?? err?.message ?? err);

    if (code === "UNAUTHENTICATED") {
      return Response.json({ ok: false, error: "UNAUTHENTICATED" }, { status: 401 });
    }

    if (code === "FORBIDDEN_NOT_ACTIVE") {
      return Response.json({ ok: false, error: "FORBIDDEN_NOT_ACTIVE" }, { status: 403 });
    }

    if (code === "BOT_NOT_FOUND") {
      return Response.json({ ok: false, error: "BOT_NOT_FOUND" }, { status: 404 });
    }

    if (code === "FORBIDDEN_BOT") {
      return Response.json({ ok: false, error: "FORBIDDEN_BOT" }, { status: 403 });
    }

    console.error("DOCUMENT_RESOLVE_ROUTE_ERROR", err);
    return Response.json(
      { ok: false, error: "SERVER_ERROR", message: String(err?.message || err) },
      { status: 500 }
    );
  }
}