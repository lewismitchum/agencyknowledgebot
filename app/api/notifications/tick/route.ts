// app/api/notifications/tick/route.ts
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getDb, type Db } from "@/lib/db";
import { ensureSchema } from "@/lib/schema";
import { requireActiveMember } from "@/lib/authz";
import { hasFeature, normalizePlan } from "@/lib/plans";

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
  // Drift-safe: doesn't require schema.ts edits
  await db.exec(`
    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      agency_id TEXT NOT NULL,
      user_id TEXT,
      kind TEXT NOT NULL,          -- "event" | "task"
      ref_id TEXT NOT NULL,        -- schedule_events.id or schedule_tasks.id
      title TEXT NOT NULL,
      scheduled_for TEXT NOT NULL, -- ISO timestamp (event start / task due)
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

  // Throttle per-agency (15 min)
  const tick = (await db.get(
    `SELECT last_run_at FROM notifications_ticks WHERE agency_id = ? LIMIT 1`,
    agencyId
  )) as { last_run_at?: string | null } | undefined;

  const now = Date.now();
  const last = tick?.last_run_at ? new Date(tick.last_run_at).getTime() : 0;
  if (last && Number.isFinite(last) && now - last < 15 * 60 * 1000) {
    return { ok: true, skipped: true, created: 0 };
  }

  const nowIso = new Date(now).toISOString();
  const horizonIso = new Date(now + 24 * 60 * 60 * 1000).toISOString();

  // Drift-safe schedule columns
  const evCols = await tableColumns(db, "schedule_events");
  const taskCols = await tableColumns(db, "schedule_tasks");

  const evTitleCol = pickFirst(evCols, ["title", "name", "summary"]) ?? "id";
  const evStartCol =
    pickFirst(evCols, ["start_at", "start_time", "starts_at", "start_datetime", "start", "startsOn"]) ??
    pickFirst(evCols, ["date", "event_time", "begins_at"]);

  const taskTitleCol = pickFirst(taskCols, ["title", "name", "summary"]) ?? "id";
  const taskDueCol = pickFirst(taskCols, ["due_at", "due_date", "due_datetime", "deadline", "due"]) ?? null;

  let created = 0;

  // EVENTS -> notifications
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

  // TASKS -> notifications (due within 24h, if due column exists)
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
     ON CONFLICT(agency_id) DO UPDATE SET last_run_at = excluded.last_run_at`,
    agencyId,
    nowIso
  );

  return { ok: true, skipped: false, created };
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireActiveMember(req);

    const db: Db = await getDb();
    await ensureSchema(db);

    // Authoritative plan from DB
    const agency = (await db.get(`SELECT plan FROM agencies WHERE id = ? LIMIT 1`, ctx.agencyId)) as
      | { plan?: string | null }
      | undefined;

    const plan = normalizePlan(agency?.plan ?? (ctx as any)?.plan ?? "free");

    // Only run tick if schedule is enabled (otherwise pointless + avoids free-tier hammering)
    if (!hasFeature(plan, "schedule")) {
      return NextResponse.json({ ok: true, skipped: true, reason: "SCHEDULE_LOCKED", plan });
    }

    const result = await runReminderTickForAgency(db, ctx.agencyId, ctx.userId);

    return NextResponse.json({
      plan,
      ...result,
    });
  } catch (err: any) {
    const code = String(err?.code ?? err?.message ?? err);
    if (code === "UNAUTHENTICATED") {
      return NextResponse.json({ ok: false, error: "UNAUTHENTICATED" }, { status: 401 });
    }
    if (code === "FORBIDDEN_NOT_ACTIVE") {
      return NextResponse.json({ ok: false, error: "FORBIDDEN_NOT_ACTIVE" }, { status: 403 });
    }

    console.error("NOTIFICATIONS_TICK_ERROR", err);
    return NextResponse.json(
      { ok: false, error: "INTERNAL_ERROR", message: String(err?.message ?? err) },
      { status: 500 }
    );
  }
}