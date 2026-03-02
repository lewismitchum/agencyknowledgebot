import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getDb, type Db } from "@/lib/db";
import { ensureSchema } from "@/lib/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function asString(v: any) {
  return typeof v === "string" ? v : String(v ?? "");
}

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

async function ensureNotificationsTables(db: Db) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      agency_id TEXT NOT NULL,
      user_id TEXT,
      kind TEXT NOT NULL,
      ref_id TEXT NOT NULL,
      title TEXT NOT NULL,
      scheduled_for TEXT NOT NULL,
      created_at TEXT NOT NULL,
      seen_at TEXT,
      sent_at TEXT
    );

    CREATE UNIQUE INDEX IF NOT EXISTS notifications_uniq
      ON notifications(agency_id, user_id, kind, ref_id);

    CREATE TABLE IF NOT EXISTS notifications_ticks (
      agency_id TEXT PRIMARY KEY,
      last_run_at TEXT
    );
  `);
}

async function runReminderTickForAgency(db: Db, agencyId: string, userId?: string | null) {
  await ensureNotificationsTables(db);

  // 15 min throttle
  const tick = (await db.get(
    `SELECT last_run_at FROM notifications_ticks WHERE agency_id = ? LIMIT 1`,
    agencyId
  )) as { last_run_at?: string | null } | undefined;

  const nowMs = Date.now();
  const lastMs = tick?.last_run_at ? new Date(tick.last_run_at).getTime() : 0;

  if (lastMs && nowMs - lastMs < 15 * 60 * 1000) {
    return { ok: true, skipped: true, created: 0 };
  }

  const nowIso = new Date(nowMs).toISOString();
  const horizonIso = new Date(nowMs + 24 * 60 * 60 * 1000).toISOString();

  const evCols = await tableColumns(db, "schedule_events");
  const taskCols = await tableColumns(db, "schedule_tasks");

  const evTitleCol = pickFirst(evCols, ["title", "name", "summary"]) ?? "id";
  const evStartCol =
    pickFirst(evCols, ["start_at", "start_time", "starts_at", "start_datetime", "start"]) ??
    pickFirst(evCols, ["date"]);

  const taskTitleCol = pickFirst(taskCols, ["title", "name", "summary"]) ?? "id";
  const taskDueCol =
    pickFirst(taskCols, ["due_at", "due_date", "due_datetime", "deadline"]) ?? null;

  let created = 0;

  // EVENTS
  if (evStartCol) {
    const rows = (await db.all(
      `SELECT id, ${evTitleCol} as title, ${evStartCol} as when_at
       FROM schedule_events
       WHERE agency_id = ?
         AND ${evStartCol} IS NOT NULL
         AND ${evStartCol} >= ?
         AND ${evStartCol} <= ?
       ORDER BY ${evStartCol} ASC
       LIMIT 50`,
      agencyId,
      nowIso,
      horizonIso
    )) as Array<{ id: string; title: string; when_at: string }>;

    for (const r of rows ?? []) {
      if (!r?.id || !r?.when_at) continue;

      const res = await db.run(
        `INSERT OR IGNORE INTO notifications
         (id, agency_id, user_id, kind, ref_id, title, scheduled_for, created_at)
         VALUES (?, ?, ?, 'event', ?, ?, ?, ?)`,
        makeId("ntf"),
        agencyId,
        userId ?? null,
        r.id,
        asString(r.title || "Event"),
        asString(r.when_at),
        nowIso
      );

      if ((res as any)?.changes) created += Number((res as any).changes) || 0;
    }
  }

  // TASKS
  if (taskDueCol) {
    const rows = (await db.all(
      `SELECT id, ${taskTitleCol} as title, ${taskDueCol} as when_at
       FROM schedule_tasks
       WHERE agency_id = ?
         AND ${taskDueCol} IS NOT NULL
         AND ${taskDueCol} >= ?
         AND ${taskDueCol} <= ?
       ORDER BY ${taskDueCol} ASC
       LIMIT 50`,
      agencyId,
      nowIso,
      horizonIso
    )) as Array<{ id: string; title: string; when_at: string }>;

    for (const r of rows ?? []) {
      if (!r?.id || !r?.when_at) continue;

      const res = await db.run(
        `INSERT OR IGNORE INTO notifications
         (id, agency_id, user_id, kind, ref_id, title, scheduled_for, created_at)
         VALUES (?, ?, ?, 'task', ?, ?, ?, ?)`,
        makeId("ntf"),
        agencyId,
        userId ?? null,
        r.id,
        asString(r.title || "Task"),
        asString(r.when_at),
        nowIso
      );

      if ((res as any)?.changes) created += Number((res as any).changes) || 0;
    }
  }

  await db.run(
    `INSERT INTO notifications_ticks (agency_id, last_run_at)
     VALUES (?, ?)
     ON CONFLICT(agency_id)
     DO UPDATE SET last_run_at = excluded.last_run_at`,
    agencyId,
    nowIso
  );

  return { ok: true, skipped: false, created };
}

export async function GET(req: NextRequest) {
  try {
    const secret = asString(process.env.CRON_SECRET || "").trim();
    const provided = asString(req.nextUrl.searchParams.get("secret") || "").trim();

    if (secret && provided !== secret) {
      return NextResponse.json({ ok: false, error: "FORBIDDEN" }, { status: 403 });
    }

    const db: Db = await getDb();
    await ensureSchema(db);

    const agencies = (await db.all(`SELECT id FROM agencies`)) as Array<{ id: string }>;
    let totalCreated = 0;

    for (const a of agencies ?? []) {
      if (!a?.id) continue;
      const result = await runReminderTickForAgency(db, a.id, null);
      totalCreated += result.created;
    }

    return NextResponse.json({ ok: true, totalCreated });
  } catch (err) {
    console.error("CRON_REMINDERS_ERROR", err);
    return NextResponse.json({ ok: false, error: "INTERNAL_ERROR" }, { status: 500 });
  }
}

// internal export (used by notifications page tick)
export async function _runReminderTickForAgency(
  db: Db,
  agencyId: string,
  userId?: string | null
) {
  return runReminderTickForAgency(db, agencyId, userId);
}