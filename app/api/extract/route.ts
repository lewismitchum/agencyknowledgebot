// app/api/extract/route.ts
import { NextRequest } from "next/server";
import { getDb, type Db } from "@/lib/db";
import { openai } from "@/lib/openai";
import { requireActiveMember } from "@/lib/authz";
import { normalizePlan, requireFeature } from "@/lib/plans";
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

async function getAgencyPlan(db: Db, agencyId: string, fallback: unknown) {
  const row = (await db.get(`SELECT plan FROM agencies WHERE id = ? LIMIT 1`, agencyId)) as
    | { plan?: string | null }
    | undefined;

  return normalizePlan(row?.plan ?? (fallback as any) ?? null);
}

function requireExtractionOr403(plan: unknown) {
  const gate = requireFeature(plan, "extraction");
  if (gate.ok) return null;
  return Response.json(gate.body, { status: gate.status });
}

function requireScheduleOr403(plan: unknown) {
  const gate = requireFeature(plan, "schedule");
  if (gate.ok) return null;
  return Response.json(gate.body, { status: gate.status });
}

function asString(v: any) {
  return typeof v === "string" ? v : String(v ?? "");
}

async function tableColumns(db: Db, table: string): Promise<Set<string>> {
  const safe = String(table).replace(/[^a-zA-Z0-9_]/g, "");
  try {
    const rows = (await db.all(`PRAGMA table_info(${safe})`)) as Array<{ name?: string }>;
    return new Set((rows ?? []).map((r) => String(r?.name ?? "").trim()).filter(Boolean));
  } catch {
    return new Set();
  }
}

async function ensureNotificationsTable(db: Db) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      agency_id TEXT NOT NULL,
      user_id TEXT,
      type TEXT,
      title TEXT,
      body TEXT,
      url TEXT,
      created_at TEXT NOT NULL,
      read_at TEXT
    );
  `);

  const cols = await tableColumns(db, "notifications");

  async function add(col: string, ddl: string) {
    if (cols.has(col)) return;
    try {
      await db.exec(`ALTER TABLE notifications ADD COLUMN ${ddl};`);
    } catch {
      // ignore
    }
  }

  await add("agency_id", "agency_id TEXT NOT NULL DEFAULT ''");
  await add("user_id", "user_id TEXT");
  await add("type", "type TEXT");
  await add("title", "title TEXT");
  await add("body", "body TEXT");
  await add("url", "url TEXT");
  await add("created_at", "created_at TEXT NOT NULL DEFAULT ''");
  await add("read_at", "read_at TEXT");

  try {
    await db.exec(`CREATE INDEX IF NOT EXISTS idx_notifications_agency_created ON notifications (agency_id, created_at DESC);`);
  } catch {}
  try {
    await db.exec(
      `CREATE INDEX IF NOT EXISTS idx_notifications_agency_user_created ON notifications (agency_id, user_id, created_at DESC);`
    );
  } catch {}
  try {
    await db.exec(`CREATE INDEX IF NOT EXISTS idx_notifications_agency_read ON notifications (agency_id, read_at);`);
  } catch {}
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireActiveMember(req);

    const db: Db = await getDb();
    await ensureSchema(db);
    await ensureNotificationsTable(db);

    // Gate using DB plan (authoritative), fallback to ctx.plan
    const plan = await getAgencyPlan(db, ctx.agencyId, ctx.plan);

    // ✅ Extraction is paid-only and implies schedule writes. Gate BOTH.
    const gatedExtraction = requireExtractionOr403(plan);
    if (gatedExtraction) return gatedExtraction;

    const gatedSchedule = requireScheduleOr403(plan);
    if (gatedSchedule) return gatedSchedule;

    const body = (await req.json().catch(() => null)) as ExtractBody | null;
    const botIdFromBody = asString(body?.bot_id).trim();
    const documentId = asString(body?.document_id).trim();

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

    // ✅ bot access: agency bot or caller owns private bot
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
      return Response.json({ error: "BOT_VECTOR_STORE_MISSING" }, { status: 409 });
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
- Use ISO 8601. If date exists but time doesn't, use T00:00:00Z.
- confidence must be between 0 and 1.
- If none found, return {"items": []}.
`.trim();

    let resp: any;
    try {
      resp = await openai.responses.create({
        model: "gpt-4.1-mini",
        instructions,
        input: `Extract ONLY from the document titled "${doc.title}". The OpenAI file id is "${doc.openai_file_id}". Do not use any other document.`,
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

      // Notification: extraction error
      try {
        await db.run(
          `INSERT INTO notifications
           (id, agency_id, user_id, type, title, body, url, created_at, read_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
          makeId("ntf"),
          ctx.agencyId,
          ctx.userId,
          "extraction_error",
          `Extraction failed: ${doc.title || "Document"}`,
          msg.slice(0, 800),
          "/app/docs",
          new Date().toISOString()
        );
      } catch {}

      return Response.json({
        ok: true,
        events_created: 0,
        tasks_created: 0,
        openai_error: msg,
      });
    }

    const text = asString(resp?.output_text).trim();
    const parsed = safeJsonParse(text);
    const items: any[] = Array.isArray((parsed as any)?.items) ? (parsed as any).items : [];

    const now = new Date().toISOString();
    let events_created = 0;
    let tasks_created = 0;

    // Optional: clear previous extraction results for this doc to avoid duplicates.
    // We keep it conservative for now (no deletes) to avoid surprise data loss.

    for (const it of items) {
      const type = it?.type === "event" ? "event" : it?.type === "task" ? "task" : null;
      const title = asString(it?.title).trim();
      if (!type || !title) continue;

      const confidenceRaw = Number(it?.confidence ?? 0);
      const confidence = Number.isFinite(confidenceRaw) ? Math.max(0, Math.min(1, confidenceRaw)) : 0;

      const excerpt = it?.source_excerpt ? asString(it.source_excerpt).slice(0, 400) : "";
      const notes = excerpt ? `${excerpt}\n\nconfidence: ${confidence}` : null;

      if (type === "event") {
        const startAt = it?.start_at ? asString(it.start_at) : "";
        if (!startAt) continue;

        const eventId = makeId("evt");

        await db.run(
          `INSERT INTO schedule_events
           (id, agency_id, bot_id, document_id, title, start_at, end_at, notes, confidence, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          eventId,
          ctx.agencyId,
          doc.bot_id,
          doc.id,
          title,
          startAt,
          it?.end_at ? asString(it.end_at) : null,
          notes,
          confidence,
          now
        );

        // Notification: event extracted
        try {
          await db.run(
            `INSERT INTO notifications
             (id, agency_id, user_id, type, title, body, url, created_at, read_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
            makeId("ntf"),
            ctx.agencyId,
            ctx.userId,
            "event_extracted",
            `Event extracted: ${title}`,
            `From: ${doc.title || doc.id}\nStart: ${startAt}${notes ? `\n\n${notes}` : ""}`.slice(0, 1200),
            "/app/schedule",
            now
          );
        } catch {}

        events_created++;
      } else {
        const taskId = makeId("tsk");

        await db.run(
          `INSERT INTO schedule_tasks
           (id, agency_id, bot_id, document_id, title, due_at, status, notes, confidence, created_at)
           VALUES (?, ?, ?, ?, ?, ?, 'open', ?, ?, ?)`,
          taskId,
          ctx.agencyId,
          doc.bot_id,
          doc.id,
          title,
          it?.due_at ? asString(it.due_at) : null,
          notes,
          confidence,
          now
        );

        // Notification: task extracted
        try {
          const dueAt = it?.due_at ? asString(it.due_at) : "";
          await db.run(
            `INSERT INTO notifications
             (id, agency_id, user_id, type, title, body, url, created_at, read_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
            makeId("ntf"),
            ctx.agencyId,
            ctx.userId,
            "task_extracted",
            `Task extracted: ${title}`,
            `From: ${doc.title || doc.id}${dueAt ? `\nDue: ${dueAt}` : ""}${notes ? `\n\n${notes}` : ""}`.slice(0, 1200),
            "/app/schedule",
            now
          );
        } catch {}

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

    // Notification: extraction summary
    try {
      await db.run(
        `INSERT INTO notifications
         (id, agency_id, user_id, type, title, body, url, created_at, read_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
        makeId("ntf"),
        ctx.agencyId,
        ctx.userId,
        "extraction_complete",
        `Extraction complete: ${doc.title || "Document"}`,
        `Created ${events_created} event(s) and ${tasks_created} task(s).`,
        "/app/notifications",
        now
      );
    } catch {}

    return Response.json({
      ok: true,
      document_id: doc.id,
      bot_id: doc.bot_id,
      events_created,
      tasks_created,
    });
  } catch (err: any) {
    const msg = String(err?.code ?? err?.message ?? err);
    if (msg === "UNAUTHENTICATED") return Response.json({ error: "Unauthorized" }, { status: 401 });
    if (msg === "FORBIDDEN_NOT_ACTIVE") return Response.json({ error: "Pending approval" }, { status: 403 });

    console.error("EXTRACT_ROUTE_ERROR", err);
    return Response.json({ error: "Server error", message: String(err?.message ?? err) }, { status: 500 });
  }
}