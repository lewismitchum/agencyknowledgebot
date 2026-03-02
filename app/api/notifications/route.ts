// app/api/notifications/route.ts
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getDb, type Db } from "@/lib/db";
import { ensureSchema } from "@/lib/schema";
import { requireActiveMember } from "@/lib/authz";
import { hasFeature, normalizePlan } from "@/lib/plans";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Upsell = { code?: string; message?: string };

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
}

function asString(v: any) {
  return typeof v === "string" ? v : String(v ?? "");
}

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireActiveMember(req);

    const db: Db = await getDb();
    await ensureSchema(db);
    await ensureNotificationsTables(db);

    const agency = (await db.get(
      `SELECT plan
       FROM agencies
       WHERE id = ?
       LIMIT 1`,
      ctx.agencyId
    )) as { plan: string | null } | undefined;

    const plan = normalizePlan(agency?.plan ?? (ctx as any)?.plan ?? "free");

    const scheduleEnabled = hasFeature(plan, "schedule");

    const upsell: Upsell | null = scheduleEnabled
      ? null
      : {
          code: "UPSELL_SCHEDULE",
          message: "Upgrade to unlock schedule + task notifications (auto-extracted from docs).",
        };

    // Notifications are visible for all plans (Corp email is separate). Free plans will just see fewer items.
    let notifications: Array<{
      id: string;
      type: string | null;
      title: string | null;
      body: string | null;
      url: string | null;
      created_at: string;
      read_at: string | null;
    }> = [];

    try {
      // user-scoped OR agency-wide (user_id null)
      notifications = (await db.all(
        `SELECT id, type, title, body, url, created_at, read_at
         FROM notifications
         WHERE agency_id = ?
           AND (user_id IS NULL OR user_id = ?)
         ORDER BY created_at DESC
         LIMIT 50`,
        ctx.agencyId,
        ctx.userId
      )) as any;
      notifications = Array.isArray(notifications) ? notifications : [];
    } catch {
      notifications = [];
    }

    // If schedule not enabled, still return notifications (could include general notices),
    // but return empty schedule-derived sections.
    if (!scheduleEnabled) {
      return NextResponse.json({
        ok: true,
        plan,
        upsell,
        notifications,
        events: [],
        tasks: [],
        extractions: [],
      });
    }

    // --- Drift-safe column detection ---
    const evCols = await tableColumns(db, "schedule_events");
    const taskCols = await tableColumns(db, "schedule_tasks");

    const evTitleCol = pickFirst(evCols, ["title", "name", "summary"]);
    const evStartCol =
      pickFirst(evCols, ["start_time", "starts_at", "start_at", "start", "startsOn", "start_datetime"]) ??
      pickFirst(evCols, ["date", "event_time", "begins_at"]) ??
      null;

    const nowIso = new Date().toISOString();

    // EVENTS (best-effort, never 500)
    let events: Array<{ id: string; title: string; start_time: string }> = [];
    try {
      if (evStartCol) {
        const titleSelect = evTitleCol ? `${evTitleCol} as title` : `id as title`;

        const rows = (await db.all(
          `SELECT id,
                  ${titleSelect},
                  ${evStartCol} as start_time
           FROM schedule_events
           WHERE agency_id = ?
             AND ${evStartCol} >= ?
           ORDER BY ${evStartCol} ASC
           LIMIT 10`,
          ctx.agencyId,
          nowIso
        )) as Array<{ id: string; title: string; start_time: string }>;

        events = (rows ?? []).filter((r) => r && r.id && r.start_time);
      }
    } catch {
      events = [];
    }

    const taskTitleCol = pickFirst(taskCols, ["title", "name", "summary"]);
    const taskDueCol = pickFirst(taskCols, ["due_date", "due_at", "due", "due_datetime", "deadline"]) ?? null;

    // Open-ness drift: prefer status; else completed_at; else is_done; else return everything (best-effort)
    const taskStatusCol = pickFirst(taskCols, ["status"]) ?? null;
    const taskCompletedAtCol = pickFirst(taskCols, ["completed_at", "done_at"]) ?? null;
    const taskIsDoneCol = pickFirst(taskCols, ["is_done", "done"]) ?? null;

    let whereOpen = "1=1";
    if (taskStatusCol) whereOpen = `( ${taskStatusCol} IS NULL OR lower(${taskStatusCol}) != 'done' )`;
    else if (taskCompletedAtCol) whereOpen = `${taskCompletedAtCol} IS NULL`;
    else if (taskIsDoneCol) whereOpen = `( ${taskIsDoneCol} IS NULL OR ${taskIsDoneCol} = 0 )`;

    const titleSelect = taskTitleCol ? `${taskTitleCol} as title` : `id as title`;
    const dueSelect = taskDueCol ? `${taskDueCol} as due_date` : `NULL as due_date`;
    const dueOrder = taskDueCol
      ? `CASE WHEN ${taskDueCol} IS NULL THEN 1 ELSE 0 END, ${taskDueCol} ASC`
      : `id DESC`;

    // TASKS (best-effort, never 500)
    let tasks: Array<{ id: string; title: string; due_date: string | null }> = [];
    try {
      tasks = (await db.all(
        `SELECT id,
                ${titleSelect},
                ${dueSelect}
         FROM schedule_tasks
         WHERE agency_id = ?
           AND ${whereOpen}
         ORDER BY ${dueOrder}
         LIMIT 25`,
        ctx.agencyId
      )) as Array<{ id: string; title: string; due_date: string | null }>;
      tasks = tasks ?? [];
    } catch {
      tasks = [];
    }

    // EXTRACTIONS (best-effort, never 500)
    let extractions: Array<{ id: string; document_id: string; created_at: string }> = [];
    try {
      extractions = (await db.all(
        `SELECT id, document_id, created_at
         FROM extractions
         WHERE agency_id = ?
         ORDER BY created_at DESC
         LIMIT 25`,
        ctx.agencyId
      )) as Array<{ id: string; document_id: string; created_at: string }>;
      extractions = extractions ?? [];
    } catch {
      extractions = [];
    }

    return NextResponse.json({
      ok: true,
      plan,
      upsell,
      notifications,
      events,
      tasks,
      extractions,
      _debug: {
        schedule_events_start_col: evStartCol,
        schedule_events_title_col: evTitleCol ?? "id",
        schedule_tasks_due_col: taskDueCol,
        schedule_tasks_title_col: taskTitleCol ?? "id",
        schedule_tasks_open_logic: taskStatusCol
          ? "status != done"
          : taskCompletedAtCol
          ? "completed_at is null"
          : taskIsDoneCol
          ? "is_done = 0"
          : "no open filter",
      },
    });
  } catch (err: any) {
    const code = String(err?.code ?? err?.message ?? err);
    if (code === "UNAUTHENTICATED") {
      return NextResponse.json({ ok: false, error: "UNAUTHENTICATED" }, { status: 401 });
    }
    if (code === "FORBIDDEN_NOT_ACTIVE") {
      return NextResponse.json({ ok: false, error: "FORBIDDEN_NOT_ACTIVE" }, { status: 403 });
    }
    console.error("NOTIFICATIONS_GET_ERROR", err);
    return NextResponse.json({ ok: false, error: "INTERNAL_ERROR", message: String(err?.message ?? err) }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const ctx = await requireActiveMember(req);

    const db: Db = await getDb();
    await ensureSchema(db);
    await ensureNotificationsTables(db);

    const body = (await req.json().catch(() => null)) as { id?: string; all?: boolean } | null;
    const id = asString(body?.id).trim();
    const all = Boolean(body?.all);

    const nowIso = new Date().toISOString();

    if (all) {
      await db.run(
        `UPDATE notifications
         SET read_at = ?
         WHERE agency_id = ?
           AND (user_id IS NULL OR user_id = ?)
           AND read_at IS NULL`,
        nowIso,
        ctx.agencyId,
        ctx.userId
      );
      return NextResponse.json({ ok: true });
    }

    if (!id) return NextResponse.json({ ok: false, error: "MISSING_ID" }, { status: 400 });

    await db.run(
      `UPDATE notifications
       SET read_at = ?
       WHERE id = ?
         AND agency_id = ?
         AND (user_id IS NULL OR user_id = ?)`,
      nowIso,
      id,
      ctx.agencyId,
      ctx.userId
    );

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    const code = String(err?.code ?? err?.message ?? err);
    if (code === "UNAUTHENTICATED") return NextResponse.json({ ok: false, error: "UNAUTHENTICATED" }, { status: 401 });
    if (code === "FORBIDDEN_NOT_ACTIVE") return NextResponse.json({ ok: false, error: "FORBIDDEN_NOT_ACTIVE" }, { status: 403 });
    console.error("NOTIFICATIONS_PATCH_ERROR", err);
    return NextResponse.json({ ok: false, error: "INTERNAL_ERROR" }, { status: 500 });
  }
}