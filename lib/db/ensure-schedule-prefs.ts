import { getDb } from "@/lib/db";

let didRun = false;

export async function ensureSchedulePrefTables() {
  if (didRun) return;
  didRun = true;

  const db: any = await getDb();

  await db.exec(`
    CREATE TABLE IF NOT EXISTS schedule_prefs (
      id TEXT PRIMARY KEY,
      agency_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      timezone TEXT,
      week_starts_on TEXT, -- "sun" | "mon"
      default_view TEXT,   -- "day" | "week" | "month"
      show_tasks INTEGER,
      show_events INTEGER,
      show_done_tasks INTEGER,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_schedule_prefs_user
    ON schedule_prefs (agency_id, user_id);
  `);
}
