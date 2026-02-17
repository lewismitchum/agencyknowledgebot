import { getDb } from "@/lib/db";

let didRun = false;

export async function ensureScheduleTables() {
  if (didRun) return;
  didRun = true;

  const db: any = await getDb();

  const exec =
    db?.run ?? db?.execute ?? db?.exec ?? db?.query ?? db?.client?.execute;

  if (typeof exec !== "function") {
    throw new Error("DB has no write method");
  }

  // schedule_events
  await exec.call(
    db,
    `
    CREATE TABLE IF NOT EXISTS schedule_events (
      id TEXT PRIMARY KEY,
      agency_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      bot_id TEXT NOT NULL,
      source_document_id TEXT,
      title TEXT NOT NULL,
      starts_at TEXT NOT NULL,
      ends_at TEXT,
      location TEXT,
      notes TEXT,
      created_at TEXT NOT NULL
    )
  `
  );

  await exec.call(
    db,
    `
    CREATE INDEX IF NOT EXISTS idx_schedule_events_agency_user
    ON schedule_events (agency_id, user_id)
  `
  );

  await exec.call(
    db,
    `
    CREATE INDEX IF NOT EXISTS idx_schedule_events_bot
    ON schedule_events (bot_id)
  `
  );

  // schedule_tasks
  await exec.call(
    db,
    `
    CREATE TABLE IF NOT EXISTS schedule_tasks (
      id TEXT PRIMARY KEY,
      agency_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      bot_id TEXT NOT NULL,
      source_document_id TEXT,
      title TEXT NOT NULL,
      due_at TEXT,
      status TEXT NOT NULL, -- 'open' | 'done'
      notes TEXT,
      created_at TEXT NOT NULL
    )
  `
  );

  await exec.call(
    db,
    `
    CREATE INDEX IF NOT EXISTS idx_schedule_tasks_agency_user
    ON schedule_tasks (agency_id, user_id)
  `
  );

  await exec.call(
    db,
    `
    CREATE INDEX IF NOT EXISTS idx_schedule_tasks_bot
    ON schedule_tasks (bot_id)
  `
  );

  await exec.call(
    db,
    `
    CREATE INDEX IF NOT EXISTS idx_schedule_tasks_status
    ON schedule_tasks (status)
  `
  );
}