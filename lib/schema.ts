// lib/schema.ts
import { getDb, type Db as RealDb } from "@/lib/db";

export const runtime = "nodejs";

/**
 * Canonical Louis.Ai schema bootstrap + drift repair.
 *
 * Rules:
 * - Safe to call on EVERY request
 * - Idempotent
 * - Repairs legacy drift instead of assuming fresh DB
 * - Matches what routes actually expect
 */

type Db = Pick<RealDb, "exec" | "run" | "get" | "all">;

let _schemaEnsured = false;

function qIdent(name: string) {
  return `"${name.replace(/"/g, '""')}"`;
}

async function tableExists(db: Db, tableName: string) {
  const row = (await db.get(
    `SELECT name FROM sqlite_master WHERE type='table' AND name=? LIMIT 1`,
    tableName
  )) as { name: string } | undefined;
  return !!row?.name;
}

async function getTableColumns(db: Db, tableName: string): Promise<string[]> {
  const rows = (await db.all(`PRAGMA table_info(${qIdent(tableName)})`)) as Array<{ name: string }>;
  return rows.map((r) => r.name);
}

function has(cols: string[], col: string) {
  return cols.includes(col);
}

async function addColumnIfMissing(db: Db, table: string, col: string, sqlTypeAndDefault: string) {
  const cols = await getTableColumns(db, table);
  if (has(cols, col)) return;
  await db.exec(`ALTER TABLE ${qIdent(table)} ADD COLUMN ${qIdent(col)} ${sqlTypeAndDefault};`);
}

/**
 * usage_daily has been a drift landmine.
 * If canonical columns are missing, rebuild safely.
 */
async function rebuildUsageDailyIfNeeded(db: Db) {
  const exists = await tableExists(db, "usage_daily");
  if (!exists) return;

  const cols = await getTableColumns(db, "usage_daily");

  const wants = ["agency_id", "date", "messages_count", "uploads_count"];
  if (wants.every((c) => has(cols, c))) return;

  const legacyAgencyCol = has(cols, "agency_id") ? "agency_id" : null;
  if (!legacyAgencyCol) return;

  const legacyDateCol = has(cols, "date") ? "date" : has(cols, "day") ? "day" : null;

  const legacyMsgCol = has(cols, "messages_count")
    ? "messages_count"
    : has(cols, "messages")
      ? "messages"
      : has(cols, "count")
        ? "count"
        : null;

  const legacyUploadsCol = has(cols, "uploads_count") ? "uploads_count" : has(cols, "uploads") ? "uploads" : null;

  const dateExpr = legacyDateCol ? qIdent(legacyDateCol) : "''";
  const msgExpr = legacyMsgCol ? qIdent(legacyMsgCol) : "0";
  const upExpr = legacyUploadsCol ? qIdent(legacyUploadsCol) : "0";

  await db.exec(`
    CREATE TABLE IF NOT EXISTS usage_daily_new (
      agency_id TEXT NOT NULL,
      date TEXT NOT NULL,
      messages_count INTEGER NOT NULL DEFAULT 0,
      uploads_count INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (agency_id, date)
    );
  `);

  await db.exec(`
    INSERT INTO usage_daily_new (agency_id, date, messages_count, uploads_count)
    SELECT
      ${qIdent(legacyAgencyCol)} AS agency_id,
      COALESCE(${dateExpr}, '') AS date,
      COALESCE(MAX(CAST(${msgExpr} AS INTEGER)), 0) AS messages_count,
      COALESCE(MAX(CAST(${upExpr} AS INTEGER)), 0) AS uploads_count
    FROM usage_daily
    GROUP BY ${qIdent(legacyAgencyCol)}, COALESCE(${dateExpr}, '');
  `);

  await db.exec(`
    DROP TABLE usage_daily;
    ALTER TABLE usage_daily_new RENAME TO usage_daily;
  `);
}

async function ensureUsageDaily(db: Db) {
  const exists = await tableExists(db, "usage_daily");
  if (!exists) return;

  const cols = await getTableColumns(db, "usage_daily");

  const missingCanonical =
    !has(cols, "agency_id") || !has(cols, "date") || !has(cols, "messages_count") || !has(cols, "uploads_count");

  if (missingCanonical) {
    await rebuildUsageDailyIfNeeded(db);
    return;
  }
}

/**
 * schedule_prefs drift repair:
 * Old versions stored one row per agency (agency_id PK) with integer week_starts_on + day hours.
 * New canonical is per-user: (agency_id, user_id) PK + view + visibility toggles + timestamps.
 *
 * If legacy table detected, rebuild and COPY the agency-level prefs to EVERY user in the agency.
 */
async function rebuildSchedulePrefsIfNeeded(db: Db) {
  const exists = await tableExists(db, "schedule_prefs");
  if (!exists) return;

  const cols = await getTableColumns(db, "schedule_prefs");

  const wants = [
    "agency_id",
    "user_id",
    "timezone",
    "week_starts_on",
    "default_view",
    "show_tasks",
    "show_events",
    "show_done_tasks",
    "created_at",
    "updated_at",
  ];

  if (wants.every((c) => has(cols, c))) return;

  const hasAgencyOnly = has(cols, "agency_id") && !has(cols, "user_id");

  const tzExpr = has(cols, "timezone") ? `timezone` : `NULL`;

  let weekExpr = `'mon'`;
  if (has(cols, "week_starts_on")) {
    weekExpr = `CASE
      WHEN CAST(week_starts_on AS TEXT) = 'sun' THEN 'sun'
      WHEN CAST(week_starts_on AS TEXT) = 'mon' THEN 'mon'
      WHEN CAST(week_starts_on AS INTEGER) = 1 THEN 'sun'
      ELSE 'mon'
    END`;
  }

  await db.exec(`
    CREATE TABLE IF NOT EXISTS schedule_prefs_new (
      agency_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      timezone TEXT,
      week_starts_on TEXT NOT NULL DEFAULT 'mon',
      default_view TEXT NOT NULL DEFAULT 'week',
      show_tasks INTEGER NOT NULL DEFAULT 1,
      show_events INTEGER NOT NULL DEFAULT 1,
      show_done_tasks INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (agency_id, user_id)
    );
  `);

  if (hasAgencyOnly) {
    await db.exec(`
      INSERT OR REPLACE INTO schedule_prefs_new (
        agency_id, user_id,
        timezone, week_starts_on, default_view,
        show_tasks, show_events, show_done_tasks,
        created_at, updated_at
      )
      SELECT
        u.agency_id AS agency_id,
        u.id AS user_id,
        sp.${tzExpr} AS timezone,
        ${weekExpr} AS week_starts_on,
        'week' AS default_view,
        1 AS show_tasks,
        1 AS show_events,
        0 AS show_done_tasks,
        datetime('now') AS created_at,
        datetime('now') AS updated_at
      FROM users u
      LEFT JOIN schedule_prefs sp
        ON sp.agency_id = u.agency_id;
    `);
  } else {
    const userIdExpr = has(cols, "user_id") ? `user_id` : `''`;

    await db.exec(`
      INSERT OR REPLACE INTO schedule_prefs_new (
        agency_id, user_id,
        timezone, week_starts_on, default_view,
        show_tasks, show_events, show_done_tasks,
        created_at, updated_at
      )
      SELECT
        agency_id AS agency_id,
        ${userIdExpr} AS user_id,
        ${tzExpr} AS timezone,
        ${weekExpr} AS week_starts_on,
        CASE
          WHEN ${has(cols, "default_view") ? "CAST(default_view AS TEXT)" : "'week'"} IN ('day','week','month')
            THEN ${has(cols, "default_view") ? "CAST(default_view AS TEXT)" : "'week'"}
          ELSE 'week'
        END AS default_view,
        ${has(cols, "show_tasks") ? "CASE WHEN show_tasks IS NULL THEN 1 ELSE CAST(show_tasks AS INTEGER) END" : "1"} AS show_tasks,
        ${has(cols, "show_events") ? "CASE WHEN show_events IS NULL THEN 1 ELSE CAST(show_events AS INTEGER) END" : "1"} AS show_events,
        ${has(cols, "show_done_tasks") ? "CASE WHEN show_done_tasks IS NULL THEN 0 ELSE CAST(show_done_tasks AS INTEGER) END" : "0"} AS show_done_tasks,
        datetime('now') AS created_at,
        datetime('now') AS updated_at
      FROM schedule_prefs;
    `);
  }

  await db.exec(`
    DROP TABLE schedule_prefs;
    ALTER TABLE schedule_prefs_new RENAME TO schedule_prefs;
  `);
}

async function ensureSchedulePrefs(db: Db) {
  const exists = await tableExists(db, "schedule_prefs");
  if (!exists) return;

  const cols = await getTableColumns(db, "schedule_prefs");
  const wants = [
    "agency_id",
    "user_id",
    "timezone",
    "week_starts_on",
    "default_view",
    "show_tasks",
    "show_events",
    "show_done_tasks",
    "created_at",
    "updated_at",
  ];

  if (!wants.every((c) => has(cols, c))) {
    await rebuildSchedulePrefsIfNeeded(db);
  }
}

/**
 * Core tables — canonical shape
 */
async function ensureCoreTables(db: Db) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS agencies (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT,
      password_hash TEXT,
      plan TEXT NOT NULL DEFAULT 'free',
      email_verified INTEGER NOT NULL DEFAULT 0,
      email_verify_token_hash TEXT,
      email_verify_expires_at TEXT,
      email_verify_last_sent_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      agency_id TEXT NOT NULL,
      email TEXT NOT NULL,
      name TEXT,
      email_verified INTEGER NOT NULL DEFAULT 0,
      role TEXT NOT NULL DEFAULT 'member',
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT,
      UNIQUE(agency_id, email)
    );

    CREATE TABLE IF NOT EXISTS bots (
      id TEXT PRIMARY KEY,
      agency_id TEXT NOT NULL,
      owner_user_id TEXT,
      name TEXT NOT NULL,
      description TEXT,
      vector_store_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS documents (
      id TEXT PRIMARY KEY,
      agency_id TEXT NOT NULL,
      bot_id TEXT NOT NULL,
      owner_user_id TEXT,
      title TEXT NOT NULL,
      mime_type TEXT,
      bytes INTEGER NOT NULL DEFAULT 0,
      openai_file_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      agency_id TEXT NOT NULL,
      bot_id TEXT NOT NULL,
      owner_user_id TEXT,
      title TEXT,
      summary TEXT,
      message_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS conversation_messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS usage_daily (
      agency_id TEXT NOT NULL,
      date TEXT NOT NULL,
      messages_count INTEGER NOT NULL DEFAULT 0,
      uploads_count INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (agency_id, date)
    );

    CREATE TABLE IF NOT EXISTS extractions (
      id TEXT PRIMARY KEY,
      agency_id TEXT NOT NULL,
      bot_id TEXT NOT NULL,
      document_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS schedule_events (
      id TEXT PRIMARY KEY,
      agency_id TEXT NOT NULL,
      bot_id TEXT NOT NULL,
      document_id TEXT,
      title TEXT NOT NULL,
      start_at TEXT NOT NULL,
      end_at TEXT,
      location TEXT,
      notes TEXT,
      confidence REAL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS schedule_tasks (
      id TEXT PRIMARY KEY,
      agency_id TEXT NOT NULL,
      bot_id TEXT NOT NULL,
      document_id TEXT,
      title TEXT NOT NULL,
      due_at TEXT,
      status TEXT NOT NULL DEFAULT 'open',
      notes TEXT,
      confidence REAL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Canonical per-user schedule prefs (route expects this)
    CREATE TABLE IF NOT EXISTS schedule_prefs (
      agency_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      timezone TEXT,
      week_starts_on TEXT NOT NULL DEFAULT 'mon',
      default_view TEXT NOT NULL DEFAULT 'week',
      show_tasks INTEGER NOT NULL DEFAULT 1,
      show_events INTEGER NOT NULL DEFAULT 1,
      show_done_tasks INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (agency_id, user_id)
    );

    -- Keep legacy table around if anything old still references it
    CREATE TABLE IF NOT EXISTS schedule_preferences (
      agency_id TEXT NOT NULL PRIMARY KEY,
      week_starts_on INTEGER NOT NULL DEFAULT 0,
      day_start_hour INTEGER NOT NULL DEFAULT 8,
      day_end_hour INTEGER NOT NULL DEFAULT 18,
      timezone TEXT
    );

    CREATE TABLE IF NOT EXISTS agency_invites (
      id TEXT PRIMARY KEY,
      agency_id TEXT NOT NULL,
      email TEXT NOT NULL,
      token TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS support_tickets (
      id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      from_email TEXT,
      from_name TEXT,
      message TEXT NOT NULL,
      page_url TEXT,
      email_sent INTEGER NOT NULL DEFAULT 0,
      email_error TEXT
    );
  `);

  // Stripe/billing columns (idempotent)
  await addColumnIfMissing(db, "agencies", "stripe_customer_id", "TEXT");
  await addColumnIfMissing(db, "agencies", "stripe_subscription_id", "TEXT");
  await addColumnIfMissing(db, "agencies", "stripe_price_id", "TEXT");
  await addColumnIfMissing(db, "agencies", "stripe_current_period_end", "TEXT");

  // Agency timezone (used for daily usage keys + schedule default tz)
  await addColumnIfMissing(db, "agencies", "timezone", "TEXT");
}

/**
 * Entry point
 */
export async function ensureSchema(dbArg?: Db) {
  if (_schemaEnsured) return;

  const db: Db = dbArg ?? ((await getDb()) as unknown as Db);

  await ensureCoreTables(db);
  await ensureUsageDaily(db);
  await ensureSchedulePrefs(db);

  _schemaEnsured = true;
}