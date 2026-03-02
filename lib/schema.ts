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
    const tzSelect = has(cols, "timezone") ? `sp.timezone` : `NULL`;

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
        ${tzSelect} AS timezone,
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
    const tzSelect = has(cols, "timezone") ? `timezone` : `NULL`;
    const defaultViewExpr = has(cols, "default_view") ? "CAST(default_view AS TEXT)" : "'week'";
    const showTasksExpr = has(cols, "show_tasks")
      ? "CASE WHEN show_tasks IS NULL THEN 1 ELSE CAST(show_tasks AS INTEGER) END"
      : "1";
    const showEventsExpr = has(cols, "show_events")
      ? "CASE WHEN show_events IS NULL THEN 1 ELSE CAST(show_events AS INTEGER) END"
      : "1";
    const showDoneExpr = has(cols, "show_done_tasks")
      ? "CASE WHEN show_done_tasks IS NULL THEN 0 ELSE CAST(show_done_tasks AS INTEGER) END"
      : "0";

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
        ${tzSelect} AS timezone,
        ${weekExpr} AS week_starts_on,
        CASE
          WHEN ${defaultViewExpr} IN ('day','week','month')
            THEN ${defaultViewExpr}
          ELSE 'week'
        END AS default_view,
        ${showTasksExpr} AS show_tasks,
        ${showEventsExpr} AS show_events,
        ${showDoneExpr} AS show_done_tasks,
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
  // IMPORTANT:
  // - Create tables first
  // - Then drift-repair columns
  // - Then create indexes that reference drift columns (user_id, etc.)
  // This prevents “no such column” crashes on legacy DBs.

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
      has_completed_onboarding INTEGER NOT NULL DEFAULT 0,
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

    CREATE TABLE IF NOT EXISTS stripe_events (
      id TEXT PRIMARY KEY,
      type TEXT,
      created_at TEXT
    );

    -- Spreadsheets (proposal + audit trail)
    CREATE TABLE IF NOT EXISTS spreadsheet_proposals (
      id TEXT PRIMARY KEY,
      agency_id TEXT NOT NULL,
      user_id TEXT, -- canonical
      created_by_user_id TEXT, -- legacy alias (routes may still write this)
      bot_id TEXT, -- optional (docs-based generation context)
      status TEXT NOT NULL DEFAULT 'proposed', -- proposed|applied|rejected
      instruction TEXT,
      csv_snapshot TEXT,
      proposal_json TEXT,
      applied_at TEXT,
      applied_by_user_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS spreadsheet_audit_log (
      id TEXT PRIMARY KEY,
      agency_id TEXT NOT NULL,
      user_id TEXT, -- canonical actor
      actor_user_id TEXT, -- legacy alias
      proposal_id TEXT NOT NULL,
      action TEXT NOT NULL, -- APPLY|REJECT
      details_json TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Email drafts (docs-backed)
    CREATE TABLE IF NOT EXISTS email_drafts (
      id TEXT PRIMARY KEY,
      agency_id TEXT NOT NULL,
      user_id TEXT, -- canonical
      created_by_user_id TEXT, -- legacy alias
      bot_id TEXT NOT NULL,
      prompt TEXT,
      subject TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // Stripe/billing columns (idempotent)
  await addColumnIfMissing(db, "agencies", "stripe_customer_id", "TEXT");
  await addColumnIfMissing(db, "agencies", "stripe_subscription_id", "TEXT");
  await addColumnIfMissing(db, "agencies", "stripe_price_id", "TEXT");
  await addColumnIfMissing(db, "agencies", "stripe_current_period_end", "TEXT");

  // Agency timezone
  await addColumnIfMissing(db, "agencies", "timezone", "TEXT");

  // Users onboarding drift
  await addColumnIfMissing(db, "users", "has_completed_onboarding", "INTEGER NOT NULL DEFAULT 0");

  // Spreadsheets drift columns + backfill
  if (await tableExists(db, "spreadsheet_proposals")) {
    await addColumnIfMissing(db, "spreadsheet_proposals", "user_id", "TEXT");
    await addColumnIfMissing(db, "spreadsheet_proposals", "created_by_user_id", "TEXT");
    await addColumnIfMissing(db, "spreadsheet_proposals", "bot_id", "TEXT");
    await addColumnIfMissing(db, "spreadsheet_proposals", "applied_at", "TEXT");
    await addColumnIfMissing(db, "spreadsheet_proposals", "applied_by_user_id", "TEXT");

    await db.exec(`
      UPDATE spreadsheet_proposals
      SET user_id = created_by_user_id
      WHERE (user_id IS NULL OR user_id = '')
        AND created_by_user_id IS NOT NULL
        AND created_by_user_id <> '';
    `);
  }

  if (await tableExists(db, "spreadsheet_audit_log")) {
    await addColumnIfMissing(db, "spreadsheet_audit_log", "user_id", "TEXT");
    await addColumnIfMissing(db, "spreadsheet_audit_log", "actor_user_id", "TEXT");

    await db.exec(`
      UPDATE spreadsheet_audit_log
      SET user_id = actor_user_id
      WHERE (user_id IS NULL OR user_id = '')
        AND actor_user_id IS NOT NULL
        AND actor_user_id <> '';
    `);
  }

  // Email drafts drift columns + backfill
  if (await tableExists(db, "email_drafts")) {
    await addColumnIfMissing(db, "email_drafts", "user_id", "TEXT");
    await addColumnIfMissing(db, "email_drafts", "created_by_user_id", "TEXT");

    await db.exec(`
      UPDATE email_drafts
      SET user_id = created_by_user_id
      WHERE (user_id IS NULL OR user_id = '')
        AND created_by_user_id IS NOT NULL
        AND created_by_user_id <> '';
    `);
  }

  // Helpful indexes (create AFTER drift repair; also safe to ignore failures on weird legacy DBs)
  try {
    await db.exec(`
      CREATE INDEX IF NOT EXISTS idx_users_agency ON users(agency_id);
      CREATE INDEX IF NOT EXISTS idx_bots_agency ON bots(agency_id);
      CREATE INDEX IF NOT EXISTS idx_docs_agency_bot ON documents(agency_id, bot_id);
      CREATE INDEX IF NOT EXISTS idx_convos_agency_bot ON conversations(agency_id, bot_id);
      CREATE INDEX IF NOT EXISTS idx_msgs_convo ON conversation_messages(conversation_id, created_at);

      CREATE INDEX IF NOT EXISTS idx_events_agency_bot ON schedule_events(agency_id, bot_id, start_at);
      CREATE INDEX IF NOT EXISTS idx_tasks_agency_bot ON schedule_tasks(agency_id, bot_id, status, due_at);

      CREATE INDEX IF NOT EXISTS idx_sp_proposals_agency_user ON spreadsheet_proposals(agency_id, user_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_sp_audit_agency_user ON spreadsheet_audit_log(agency_id, user_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_email_drafts_agency_user ON email_drafts(agency_id, user_id, created_at);
    `);
  } catch {
    // If an index fails due to unexpected legacy drift, we prefer the app to keep running.
  }
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