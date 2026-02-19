// app/api/extract/route.ts
import { NextRequest } from "next/server";
import { getDb, type Db } from "@/lib/db";
import { openai } from "@/lib/openai";
import { requireActiveMember } from "@/lib/authz";
import { requireFeature } from "@/lib/plans";
import { ensureSchema } from "@/lib/schema";

export const runtime = "nodejs";

type ExtractBody = {
  bot_id?: string;
  document_id?: string;
};

function safeJsonParse(s: string) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function makeId(prefix: string) {
  const uuid =
    globalThis.crypto && "randomUUID" in globalThis.crypto
      ? (globalThis.crypto as any).randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}_${uuid}`;
}

function requireExtractionOr403(plan: unknown) {
  const gate = requireFeature(plan, "extraction");
  if (gate.ok) return null;
  return Response.json(gate.body, { status: gate.status });
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireActiveMember(req);

    const gated = requireExtractionOr403(ctx.plan);
    if (gated) return gated;

    const db: Db = await getDb();
    await ensureSchema(db);

    const body = (await req.json().catch(() => null)) as ExtractBody | null;
    const botIdFromBody = String(body?.bot_id ?? "").trim();
    const documentId = String(body?.document_id ?? "").trim();

    if (!documentId) return Response.json({ error: "Missing document_id" }, { status: 400 });
    if (!botIdFromBody) return Response.json({ error: "Missing bot_id" }, { status: 400 });

    const doc = (await db.get(
      `SELECT id, agency_id, bot_id, title, openai_file_id
       FROM documents
       WHERE id = ? AND agency_id = ?
       LIMIT 1`,
      documentId,
      ctx.agencyId
    )) as
      | {
          id: string;
          agency_id: string;
          bot_id: string;
          title: string;
          openai_file_id: string | null;
        }
      | undefined;

    if (!doc?.id) {
      return Response.json({ error: "DOCUMENT_NOT_FOUND" }, { status: 404 });
    }

    if (doc.bot_id !== botIdFromBody) {
      return Response.json(
        {
          error: "DOCUMENT_BOT_MISMATCH",
          document_bot_id: doc.bot_id,
          requested_bot_id: botIdFromBody,
        },
        { status: 400 }
      );
    }

    if (!doc.openai_file_id) {
      return Response.json({ error: "Document missing openai_file_id" }, { status: 400 });
    }

    const bot = (await db.get(
      `SELECT id, vector_store_id
       FROM bots
       WHERE id = ? AND agency_id = ?
         AND (owner_user_id IS NULL OR owner_user_id = ?)
       LIMIT 1`,
      doc.bot_id,
      ctx.agencyId,
      ctx.userId
    )) as { id: string; vector_store_id: string | null } | undefined;

    if (!bot?.id) {
      return Response.json({ error: "BOT_NOT_FOUND" }, { status: 404 });
    }

    if (!bot.vector_store_id) {
      return Response.json(
        { error: "Bot has no vector_store_id (billing or quota issue)" },
        { status: 400 }
      );
    }

    const instructions = `
You extract structured events and tasks ONLY from the provided document.
Do NOT invent anything.

Return ONLY valid JSON:

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
- If date exists but time doesn't, use T00:00:00Z.
- confidence must be between 0 and 1.
- If none found, return {"items": []}.
`.trim();

    let resp: any;
    try {
      resp = await openai.responses.create({
        model: "gpt-4.1-mini",
        instructions,
        input: `Extract from document "${doc.title}" only.`,
        tools: [
          {
            type: "file_search",
            vector_store_ids: [bot.vector_store_id],
          },
        ],
      });
    } catch (e: any) {
      const msg = String(e?.message ?? e);

      await db.run(
        `INSERT INTO extractions
         (id, agency_id, bot_id, document_id, kind, created_at)
         VALUES (?, ?, ?, ?, 'error', ?)`,
        makeId("ext"),
        ctx.agencyId,
        doc.bot_id,
        doc.id,
        new Date().toISOString()
      );

      return Response.json({
        ok: true,
        events_created: 0,
        tasks_created: 0,
        openai_error: msg,
      });
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

      const confidenceRaw = Number(it?.confidence ?? 0);
      const confidence = Number.isFinite(confidenceRaw)
        ? Math.max(0, Math.min(1, confidenceRaw))
        : 0;

      const notes = it?.source_excerpt
        ? `${String(it.source_excerpt).slice(0, 400)}\n\nconfidence: ${confidence}`
        : null;

      if (type === "event") {
        if (!it?.start_at) continue;

        await db.run(
          `INSERT INTO schedule_events
           (id, agency_id, bot_id, document_id, title, start_at, end_at, notes, confidence, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          makeId("evt"),
          ctx.agencyId,
          doc.bot_id,
          doc.id,
          title,
          String(it.start_at),
          it.end_at ? String(it.end_at) : null,
          notes,
          confidence,
          now
        );

        events_created++;
      } else {
        await db.run(
          `INSERT INTO schedule_tasks
           (id, agency_id, bot_id, document_id, title, due_at, status, notes, confidence, created_at)
           VALUES (?, ?, ?, ?, ?, ?, 'open', ?, ?, ?)`,
          makeId("tsk"),
          ctx.agencyId,
          doc.bot_id,
          doc.id,
          title,
          it?.due_at ? String(it.due_at) : null,
          notes,
          confidence,
          now
        );

        tasks_created++;
      }
    }

    await db.run(
      `INSERT INTO extractions
       (id, agency_id, bot_id, document_id, kind, created_at)
       VALUES (?, ?, ?, ?, 'success', ?)`,
      makeId("ext"),
      ctx.agencyId,
      doc.bot_id,
      doc.id,
      now
    );

    return Response.json({
      ok: true,
      document_id: doc.id,
      bot_id: doc.bot_id,
      events_created,
      tasks_created,
    });
  } catch (err: any) {
    const code = String(err?.code ?? err?.message ?? err);
    if (code === "UNAUTHENTICATED") return Response.json({ error: "Unauthorized" }, { status: 401 });
    if (code === "FORBIDDEN_NOT_ACTIVE") return Response.json({ error: "Forbidden" }, { status: 403 });

    console.error("EXTRACT_ROUTE_ERROR", err);
    return Response.json({ error: "Server error", message: String(err?.message ?? err) }, { status: 500 });
  }
}
