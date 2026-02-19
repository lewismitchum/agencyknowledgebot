// lib/schema.ts
import { getDb, type Db as RealDb } from "@/lib/db";

export const runtime = "nodejs";

/**
 * Louis.Ai schema bootstrap + drift repair.
 *
 * Key requirement:
 * - MUST be safe to run on every request.
 * - MUST tolerate older DBs where tables existed with missing columns.
 *
 * Backwards compatibility:
 * - allow BOTH: ensureSchema() and ensureSchema(db)
 */

type Db = Pick<RealDb, "exec" | "run" | "get" | "all">;

let _schemaEnsured = false;

function qIdent(name: string) {
  // Minimal identifier quoting for SQLite/libsql
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

async function rebuildUsageDailyIfNeeded(db: Db) {
  const exists = await tableExists(db, "usage_daily");
  if (!exists) return;

  const cols = await getTableColumns(db, "usage_daily");

  // Canonical shape we want:
  const wants = ["agency_id", "date", "messages_count", "uploads_count"];

  // If it already has the canonical columns, we only need to patch missing ones (rare).
  const hasAllCanonical = wants.every((c) => has(cols, c));
  if (hasAllCanonical) return;

  // Detect common legacy column names
  const legacyDateCol = has(cols, "day") ? "day" : has(cols, "date") ? "date" : null;
  const legacyMsgCol = has(cols, "count")
    ? "count"
    : has(cols, "messages")
      ? "messages"
      : has(cols, "messages_count")
        ? "messages_count"
        : null;

  const legacyUploadsCol = has(cols, "uploads_count") ? "uploads_count" : has(cols, "uploads") ? "uploads" : null;

  // If we can't confidently map, still rebuild but set safe defaults.
  const dateExpr = legacyDateCol ? qIdent(legacyDateCol) : "''";
  const msgExpr = legacyMsgCol ? qIdent(legacyMsgCol) : "0";
  const upExpr = legacyUploadsCol ? qIdent(legacyUploadsCol) : "0";

  // agency_id is required; if missing, we cannot reconstruct rows reliably.
  const legacyAgencyCol = has(cols, "agency_id") ? "agency_id" : null;
  if (!legacyAgencyCol) return;

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
      ${qIdent(legacyAgencyCol)} as agency_id,
      COALESCE(${dateExpr}, '') as date,
      COALESCE(MAX(CAST(${msgExpr} AS INTEGER)), 0) as messages_count,
      COALESCE(MAX(CAST(${upExpr} AS INTEGER)), 0) as uploads_count
    FROM usage_daily
    GROUP BY ${qIdent(legacyAgencyCol)}, COALESCE(${dateExpr}, '')
    ;
  `);

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

async function ensureCoreTables(db: Db) {
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
}

async function ensureAgenciesColumns(db: Db) {
  const exists = await tableExists(db, "agencies");
  if (!exists) return;

  const cols = await getTableColumns(db, "agencies");

  // Add columns that newer auth flows expect.
  // Safe: ALTER TABLE will throw if column already exists; ignore.
  if (!has(cols, "password_hash")) {
    await db.exec(`ALTER TABLE agencies ADD COLUMN password_hash TEXT;`);
  }
  if (!has(cols, "vector_store_id")) {
    await db.exec(`ALTER TABLE agencies ADD COLUMN vector_store_id TEXT;`);
  }
  if (!has(cols, "email_verified")) {
    await db.exec(`ALTER TABLE agencies ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 0;`);
  }
  if (!has(cols, "email_verify_token_hash")) {
    await db.exec(`ALTER TABLE agencies ADD COLUMN email_verify_token_hash TEXT;`);
  }
  if (!has(cols, "email_verify_expires_at")) {
    await db.exec(`ALTER TABLE agencies ADD COLUMN email_verify_expires_at TEXT;`);
  }
  if (!has(cols, "email_verify_last_sent_at")) {
    await db.exec(`ALTER TABLE agencies ADD COLUMN email_verify_last_sent_at TEXT;`);
  }
}

/**
 * Ensure the full DB schema exists, plus apply drift repairs.
 * Safe to call in every API route before DB usage.
 *
 * Supports:
 *   await ensureSchema()
 *   await ensureSchema(db)
 */
export async function ensureSchema(dbArg?: Db) {
  if (_schemaEnsured) return;

  const db: Db = dbArg ?? ((await getDb()) as unknown as Db);

  await ensureCoreTables(db);

  // ✅ Patch older DBs that already have agencies table but lack auth columns.
  await ensureAgenciesColumns(db);

  await ensureUsageDailyColumns(db);

  _schemaEnsured = true;
}
