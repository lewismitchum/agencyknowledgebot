// lib/schema.ts
export const runtime = "nodejs";

/**
 * Louis.Ai schema bootstrap + drift repair.
 *
 * Key requirement:
 * - MUST be safe to run on every request.
 * - MUST tolerate older DBs where usage_daily was created with different columns
 *   (e.g. `count` instead of `messages_count`, `day` instead of `date`).
 */

type Db = {
  exec: (sql: string) => Promise<unknown>;
  run: (sql: string, params?: any[]) => Promise<unknown>; // <-- accept your real return shape
  get: <T = any>(sql: string, params?: any[]) => Promise<T | undefined>;
  all: <T = any>(sql: string, params?: any[]) => Promise<T[]>;
};

let _schemaEnsured = false;

function qIdent(name: string) {
  // Minimal identifier quoting for SQLite
  return `"${name.replace(/"/g, '""')}"`;
}

async function tableExists(db: Db, tableName: string) {
  const row = await db.get<{ name: string }>(
    `SELECT name FROM sqlite_master WHERE type='table' AND name=? LIMIT 1`,
    [tableName]
  );
  return !!row?.name;
}

async function getTableColumns(db: Db, tableName: string): Promise<string[]> {
  const rows = await db.all<{ name: string }>(`PRAGMA table_info(${qIdent(tableName)})`);
  return rows.map((r) => r.name);
}

function has(cols: string[], col: string) {
  return cols.includes(col);
}

async function rebuildUsageDailyIfNeeded(db: Db) {
  const exists = await tableExists(db, "usage_daily");
  if (!exists) return;

  const cols = await getTableColumns(db, "usage_daily");

  // Canonical shape we want:
  const wants = ["agency_id", "date", "messages_count", "uploads_count"];

  // If it already has the canonical columns, we only need to patch missing ones (rare).
  const hasAllCanonical = wants.every((c) => has(cols, c));
  if (hasAllCanonical) {
    return;
  }

  // Detect common legacy column names
  const legacyDateCol = has(cols, "day") ? "day" : has(cols, "date") ? "date" : null;
  const legacyMsgCol = has(cols, "count")
    ? "count"
    : has(cols, "messages")
      ? "messages"
      : has(cols, "messages_count")
        ? "messages_count"
        : null;

  const legacyUploadsCol = has(cols, "uploads_count")
    ? "uploads_count"
    : has(cols, "uploads")
      ? "uploads"
      : null;

  // If we can't confidently map, still rebuild but set safe defaults.
  // (Better to keep chat alive than block on perfect historical data.)
  const dateExpr = legacyDateCol ? qIdent(legacyDateCol) : "''";
  const msgExpr = legacyMsgCol ? qIdent(legacyMsgCol) : "0";
  const upExpr = legacyUploadsCol ? qIdent(legacyUploadsCol) : "0";

  // agency_id is required; if missing, we cannot reconstruct rows reliably.
  const legacyAgencyCol = has(cols, "agency_id") ? "agency_id" : null;
  if (!legacyAgencyCol) return;

  // Rebuild into canonical schema with proper primary key.
  await db.exec(`
    CREATE TABLE IF NOT EXISTS usage_daily_new (
      agency_id TEXT NOT NULL,
      date TEXT NOT NULL,
      messages_count INTEGER NOT NULL DEFAULT 0,
      uploads_count INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (agency_id, date)
    );
  `);

  // Copy rows. If the old table has duplicates, keep the max counts per day.
  await db.exec(`
    INSERT INTO usage_daily_new (agency_id, date, messages_count, uploads_count)
    SELECT
      ${qIdent(legacyAgencyCol)} as agency_id,
      COALESCE(${dateExpr}, '') as date,
      COALESCE(MAX(CAST(${msgExpr} AS INTEGER)), 0) as messages_count,
      COALESCE(MAX(CAST(${upExpr} AS INTEGER)), 0) as uploads_count
    FROM usage_daily
    GROUP BY ${qIdent(legacyAgencyCol)}, COALESCE(${dateExpr}, '')
    ;
  `);

  // Swap tables.
  await db.exec(`
    DROP TABLE usage_daily;
    ALTER TABLE usage_daily_new RENAME TO usage_daily;
  `);
}

async function ensureUsageDailyColumns(db: Db) {
  const exists = await tableExists(db, "usage_daily");
  if (!exists) return;

  const cols = await getTableColumns(db, "usage_daily");

  // If we are missing canonical columns, rebuild (best fix for old PK + naming drift).
  const missingCanonical =
    !has(cols, "agency_id") || !has(cols, "date") || !has(cols, "messages_count") || !has(cols, "uploads_count");

  if (missingCanonical) {
    await rebuildUsageDailyIfNeeded(db);
    return;
  }

  // If only a subset is missing (rare), patch with ALTER TABLE.
  const cols2 = await getTableColumns(db, "usage_daily");
  if (!has(cols2, "messages_count")) {
    await db.exec(`ALTER TABLE usage_daily ADD COLUMN messages_count INTEGER NOT NULL DEFAULT 0;`);
  }
  if (!has(cols2, "uploads_count")) {
    await db.exec(`ALTER TABLE usage_daily ADD COLUMN uploads_count INTEGER NOT NULL DEFAULT 0;`);
  }
}

/**
 * Ensure the full DB schema exists, plus apply drift repairs.
 * Safe to call in every API route before DB usage.
 */
export async function ensureSchema(db: Db) {
  if (_schemaEnsured) return;

  // Core tables (create-if-missing). Keep these idempotent.
  await db.exec(`
    CREATE TABLE IF NOT EXISTS agencies (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT,
      plan TEXT NOT NULL DEFAULT 'free',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      agency_id TEXT NOT NULL,
      email TEXT NOT NULL,
      name TEXT,
      role TEXT NOT NULL DEFAULT 'member',
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
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

    -- Canonical usage_daily: the one that broke in your error.
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

    CREATE TABLE IF NOT EXISTS schedule_prefs (
      agency_id TEXT NOT NULL PRIMARY KEY,
      week_starts_on INTEGER NOT NULL DEFAULT 0,
      day_start_hour INTEGER NOT NULL DEFAULT 8,
      day_end_hour INTEGER NOT NULL DEFAULT 18,
      timezone TEXT
    );

    -- Legacy table tolerated if it already exists; kept here only so old DBs don't error on reads elsewhere.
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
  `);

  // Drift repair: usage_daily is the known offender.
  await ensureUsageDailyColumns(db);

  _schemaEnsured = true;
}
