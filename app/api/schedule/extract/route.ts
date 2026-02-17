import type { NextRequest } from "next/server";
import { ensureScheduleTables } from "@/lib/db/migrations";
import { getDb, type Db } from "@/lib/db";
import { requireActiveMember } from "@/lib/authz";
import { openai } from "@/lib/openai";
import { normalizePlan } from "@/lib/plans";

export const runtime = "nodejs";

type ExtractBody = {
  bot_id?: string;
  document_id?: string;
};

function isPaidPlan(plan: string | null | undefined) {
  const p = String(normalizePlan(plan ?? null)).toLowerCase();
  return p !== "free";
}

function safeJsonParse(s: string) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function makeId(prefix: "evt" | "tsk") {
  const uuid =
    globalThis.crypto &&
    "randomUUID" in globalThis.crypto &&
    (globalThis.crypto as any).randomUUID
      ? (globalThis.crypto as any).randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}_${uuid}`;
}

export async function POST(req: NextRequest) {
  try {
    await ensureScheduleTables();

    const ctx = await requireActiveMember(req);

    // ✅ Paid feature gate (extraction -> schedule is paid only)
    if (!isPaidPlan(ctx.plan)) {
      return Response.json({ ok: false, error: "PAID_FEATURE" }, { status: 402 });
    }

    const body = (await req.json().catch(() => null)) as ExtractBody | null;
    const botIdFromBody = String(body?.bot_id ?? "").trim();
    const documentId = String(body?.document_id ?? "").trim();

    if (!documentId) return Response.json({ error: "Missing document_id" }, { status: 400 });
    if (!botIdFromBody) return Response.json({ error: "Missing bot_id" }, { status: 400 });

    const db: Db = await getDb();

    // Load doc (must belong to this agency)
    const doc = (await db.get(
      `SELECT id, agency_id, bot_id, filename, openai_file_id
       FROM documents
       WHERE id = ? AND agency_id = ?
       LIMIT 1`,
      documentId,
      ctx.agencyId
    )) as
      | {
          id: string;
          agency_id: string;
          bot_id: string | null;
          filename: string;
          openai_file_id: string | null;
        }
      | undefined;

    if (!doc?.id) {
      return Response.json(
        { error: "Not found", where: "documents lookup", documentId, agencyId: ctx.agencyId },
        { status: 404 }
      );
    }

    if (!doc.bot_id) return Response.json({ error: "Document missing bot_id" }, { status: 400 });
    if (doc.bot_id !== botIdFromBody) {
      return Response.json(
        {
          error: "Document belongs to a different bot",
          document_bot_id: doc.bot_id,
          requested_bot_id: botIdFromBody,
        },
        { status: 400 }
      );
    }
    if (!doc.openai_file_id) {
      return Response.json({ error: "Document missing openai_file_id" }, { status: 400 });
    }

    // Authorize bot: agency bot OR this user's private bot
    const botOk = (await db.get(
      `SELECT id, vector_store_id
       FROM bots
       WHERE id = ? AND agency_id = ?
         AND (owner_user_id IS NULL OR owner_user_id = ?)
       LIMIT 1`,
      doc.bot_id,
      ctx.agencyId,
      ctx.userId
    )) as { id: string; vector_store_id: string | null } | undefined;

    if (!botOk?.id) {
      return Response.json(
        {
          error: "Not found",
          where: "bot authorization",
          bot_id: doc.bot_id,
          agencyId: ctx.agencyId,
          userId: ctx.userId,
        },
        { status: 404 }
      );
    }
    if (!botOk.vector_store_id) {
      return Response.json(
        { error: "Bot has no vector_store_id (uploads/billing may be blocked)", bot_id: doc.bot_id },
        { status: 400 }
      );
    }

    const instructions = `
You extract structured events and tasks ONLY from the provided document(s).
Do NOT invent anything. If the document does not clearly specify an item, do not include it.

Return ONLY valid JSON matching this schema:

{
  "items": [
    {
      "type": "event" | "task",
      "title": string,
      "start_at": string | null,
      "end_at": string | null,
      "due_at": string | null,
      "confidence": number,
      "source_excerpt": string
    }
  ]
}

Rules:
- If date exists but time doesn't, still output date with "T00:00:00Z" (best effort).
- Keep source_excerpt short (<= 200 chars).
- confidence should be high only when the doc is explicit.
- If none found, return {"items": []}.
`.trim();

    const input = `Extract events/tasks from this document only.
Filename: ${doc.filename}
OpenAI file id: ${doc.openai_file_id}
Document id (DB): ${doc.id}`;

    let resp: any;
    try {
      resp = await openai.responses.create({
        model: "gpt-4.1-mini",
        instructions,
        input,
        tools: [
          {
            type: "file_search",
            vector_store_ids: [botOk.vector_store_id],
          },
        ],
      });
    } catch (e: any) {
      const msg = String(e?.message ?? e);
      console.error("SCHEDULE_EXTRACT_OPENAI_ERROR", e);
      return Response.json(
        { ok: true, events_created: 0, tasks_created: 0, message: "OpenAI error", openai_error: msg },
        { status: 200 }
      );
    }

    const text = String(resp?.output_text ?? "").trim();
    const parsed = safeJsonParse(text);
    const items: any[] = Array.isArray(parsed?.items) ? parsed.items : [];

    const now = new Date().toISOString();

    let events_created = 0;
    let tasks_created = 0;

    for (const it of items) {
      const type = it?.type === "event" ? "event" : it?.type === "task" ? "task" : null;
      const title = String(it?.title ?? "").trim();
      if (!type || !title) continue;

      const start_at = it?.start_at ? String(it.start_at) : null;
      const end_at = it?.end_at ? String(it.end_at) : null;
      const due_at = it?.due_at ? String(it.due_at) : null;

      const confidenceRaw = Number(it?.confidence ?? 0);
      const confidence = Number.isFinite(confidenceRaw) ? Math.max(0, Math.min(1, confidenceRaw)) : 0;

      const source_excerpt = it?.source_excerpt ? String(it.source_excerpt).slice(0, 400) : "";
      const notes =
        source_excerpt || confidence > 0
          ? `${source_excerpt}${source_excerpt ? "\n\n" : ""}confidence: ${confidence}`
          : null;

      if (type === "event") {
        if (!start_at) continue;

        await db.run(
          `INSERT INTO schedule_events (
            id, agency_id, user_id, bot_id, source_document_id,
            title, starts_at, ends_at, location, notes, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          makeId("evt"),
          ctx.agencyId,
          ctx.userId,
          doc.bot_id,
          doc.id,
          title,
          start_at,
          end_at,
          null,
          notes,
          now
        );
        events_created++;
      } else {
        await db.run(
          `INSERT INTO schedule_tasks (
            id, agency_id, user_id, bot_id, source_document_id,
            title, due_at, status, notes, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          makeId("tsk"),
          ctx.agencyId,
          ctx.userId,
          doc.bot_id,
          doc.id,
          title,
          due_at,
          "open",
          notes,
          now
        );
        tasks_created++;
      }
    }

    return Response.json({
      ok: true,
      document_id: doc.id,
      bot_id: doc.bot_id,
      events_created,
      tasks_created,
      raw: text,
    });
  } catch (err: any) {
    const msg = String(err?.code ?? err?.message ?? err);

    if (msg === "UNAUTHENTICATED") return Response.json({ error: "Unauthorized" }, { status: 401 });
    if (msg === "FORBIDDEN_NOT_ACTIVE") return Response.json({ error: "Forbidden" }, { status: 403 });
    if (msg === "FORBIDDEN_NOT_OWNER") return Response.json({ error: "Owner only" }, { status: 403 });

    console.error("SCHEDULE_EXTRACT_ERROR", err);
    return Response.json({ error: "Server error", message: msg }, { status: 500 });
  }
}
