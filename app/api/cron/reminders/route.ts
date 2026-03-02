// app/api/cron/reminders/route.ts
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getDb, type Db } from "@/lib/db";
import { ensureSchema } from "@/lib/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function makeId(prefix: string) {
  const uuid =
    globalThis.crypto && "randomUUID" in globalThis.crypto
      ? (globalThis.crypto as any).randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}_${uuid}`;
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

function pickFirst(cols: Set<string>, options: string[]): string | null {
  for (const c of options) if (cols.has(c)) return c;
  return null;
}

function asString(v: any) {
  return typeof v === "string" ? v : String(v ?? "");
}

async function ensureNotificationsTables(db: Db) {
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

  await db.exec(`
    CREATE TABLE IF NOT EXISTS notification_dedup (
      id TEXT PRIMARY KEY,
      agency_id TEXT NOT NULL,
      dedup_key TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);

  try {
    await db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_notification_dedup_key ON notification_dedup (agency_id, dedup_key);`);
  } catch {}

  try {
    await db.exec(`CREATE INDEX IF NOT EXISTS idx_notifications_agency_created ON notifications (agency_id, created_at DESC);`);
  } catch {}
}

function requireCronSecret(req: NextRequest) {
  const want = process.env.CRON_SECRET || process.env.VERCEL_CRON_SECRET || "";
  if (!want) return null; // allow if not configured (dev)
  const got =
    req.headers.get("x-cron-secret") ||
    req.headers.get("x-vercel-cron-secret") ||
    req.headers.get("authorization") ||
    "";
  const token = got.startsWith("Bearer ") ? got.slice("Bearer ".length) : got;
  if (token !== want) return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 401 });
  return null;
}

function isoPlusMinutes(d: Date, minutes: number) {
  return new Date(d.getTime() + minutes * 60 * 1000).toISOString();
}

function isoPlusHours(d: Date, hours: number) {
  return new Date(d.getTime() + hours * 60 * 60 * 1000).toISOString();
}

async function insertDedupOnce(db: Db, agencyId: string, dedupKey: string) {
  try {
    await db.run(
      `INSERT INTO notification_dedup (id, agency_id, dedup_key, created_at)
       VALUES (?, ?, ?, ?)`,
      makeId("nd"),
      agencyId,
      dedupKey,
      new Date().toISOString()
    );
    return true;
  } catch {
    return false; // already exists or table drift
  }
}

export async function GET(req: NextRequest) {
  const secretGate = requireCronSecret(req);
  if (secretGate) return secretGate;

  const startedAt = Date.now();

  const db: Db = await getDb();
  await ensureSchema(db);
  await ensureNotificationsTables(db);

  // Find columns drift
  const evCols = await tableColumns(db, "schedule_events");
  const taskCols = await tableColumns(db, "schedule_tasks");

  const evTitleCol = pickFirst(evCols, ["title", "name", "summary"]) ?? null;
  const evStartCol =
    pickFirst(evCols, ["start_time", "starts_at", "start_at", "start", "startsOn", "start_datetime"]) ??
    pickFirst(evCols, ["date", "event_time", "begins_at"]) ??
    null;

  const taskTitleCol = pickFirst(taskCols, ["title", "name", "summary"]) ?? null;
  const taskDueCol = pickFirst(taskCols, ["due_date", "due_at", "due", "due_datetime", "deadline"]) ?? null;

  // Open-ness drift
  const taskStatusCol = pickFirst(taskCols, ["status"]) ?? null;
  const taskCompletedAtCol = pickFirst(taskCols, ["completed_at", "done_at"]) ?? null;
  const taskIsDoneCol = pickFirst(taskCols, ["is_done", "done"]) ?? null;

  let whereOpen = "1=1";
  if (taskStatusCol) whereOpen = `( ${taskStatusCol} IS NULL OR lower(${taskStatusCol}) != 'done' )`;
  else if (taskCompletedAtCol) whereOpen = `${taskCompletedAtCol} IS NULL`;
  else if (taskIsDoneCol) whereOpen = `( ${taskIsDoneCol} IS NULL OR ${taskIsDoneCol} = 0 )`;

  // Agencies with schedule enabled (plan != free typically), but we keep it permissive:
  // if they have schedule tables populated, this will work. You can tighten later.
  const agencies = (await db.all(`SELECT id, plan FROM agencies`)) as Array<{ id: string; plan: string | null }>;
  const now = new Date();

  const windowStart = now.toISOString();
  const windowEventEnd = isoPlusMinutes(now, 30); // upcoming events in next 30 min
  const windowTaskEnd = isoPlusHours(now, 24); // tasks due in next 24 hours

  let eventsNotified = 0;
  let tasksNotified = 0;

  for (const a of agencies ?? []) {
    const agencyId = asString(a?.id).trim();
    if (!agencyId) continue;

    // EVENTS
    if (evStartCol) {
      const titleSelect = evTitleCol ? `${evTitleCol} as title` : `id as title`;

      let rows: Array<{ id: string; title: string; start_time: string; bot_id?: string | null }> = [];
      try {
        rows = (await db.all(
          `SELECT id,
                  ${titleSelect},
                  ${evStartCol} as start_time,
                  bot_id
           FROM schedule_events
           WHERE agency_id = ?
             AND ${evStartCol} >= ?
             AND ${evStartCol} <= ?
           ORDER BY ${evStartCol} ASC
           LIMIT 50`,
          agencyId,
          windowStart,
          windowEventEnd
        )) as any;
      } catch {
        rows = [];
      }

      for (const r of rows ?? []) {
        const eventId = asString(r?.id).trim();
        const title = asString(r?.title).trim() || "Upcoming event";
        const startTime = asString(r?.start_time).trim();
        if (!eventId || !startTime) continue;

        const dedupKey = `event:${eventId}:${startTime.slice(0, 16)}`; // minute-level
        const ok = await insertDedupOnce(db, agencyId, dedupKey);
        if (!ok) continue;

        await db.run(
          `INSERT INTO notifications (id, agency_id, user_id, type, title, body, url, created_at, read_at)
           VALUES (?, ?, NULL, ?, ?, ?, ?, ?, NULL)`,
          makeId("ntf"),
          agencyId,
          "event_upcoming",
          title,
          `Starts at ${new Date(startTime).toLocaleString()}`,
          "/app/schedule",
          new Date().toISOString()
        );

        eventsNotified++;
      }
    }

    // TASKS
    if (taskDueCol) {
      const titleSelect = taskTitleCol ? `${taskTitleCol} as title` : `id as title`;

      let rows: Array<{ id: string; title: string; due_time: string | null; bot_id?: string | null }> = [];
      try {
        rows = (await db.all(
          `SELECT id,
                  ${titleSelect},
                  ${taskDueCol} as due_time,
                  bot_id
           FROM schedule_tasks
           WHERE agency_id = ?
             AND ${whereOpen}
             AND ${taskDueCol} IS NOT NULL
             AND ${taskDueCol} >= ?
             AND ${taskDueCol} <= ?
           ORDER BY ${taskDueCol} ASC
           LIMIT 100`,
          agencyId,
          windowStart,
          windowTaskEnd
        )) as any;
      } catch {
        rows = [];
      }

      for (const r of rows ?? []) {
        const taskId = asString(r?.id).trim();
        const title = asString(r?.title).trim() || "Task due soon";
        const dueTime = r?.due_time ? asString(r.due_time).trim() : "";
        if (!taskId || !dueTime) continue;

        const dedupKey = `task:${taskId}:${dueTime.slice(0, 13)}`; // hour-level
        const ok = await insertDedupOnce(db, agencyId, dedupKey);
        if (!ok) continue;

        await db.run(
          `INSERT INTO notifications (id, agency_id, user_id, type, title, body, url, created_at, read_at)
           VALUES (?, ?, NULL, ?, ?, ?, ?, ?, NULL)`,
          makeId("ntf"),
          agencyId,
          "task_due",
          title,
          `Due by ${new Date(dueTime).toLocaleString()}`,
          "/app/schedule",
          new Date().toISOString()
        );

        tasksNotified++;
      }
    }
  }

  return NextResponse.json({
    ok: true,
    eventsNotified,
    tasksNotified,
    ms: Date.now() - startedAt,
    _debug: {
      schedule_events_start_col: evStartCol,
      schedule_events_title_col: evTitleCol ?? "id",
      schedule_tasks_due_col: taskDueCol,
      schedule_tasks_title_col: taskTitleCol ?? "id",
    },
  });
}