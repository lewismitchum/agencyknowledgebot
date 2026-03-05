// lib/usage.ts
import type { Db } from "@/lib/db";

export type UsageDailyRow = {
  agency_id: string;
  user_id: string; // legacy/compat: some parts of the app are agency-only, but schema supports per-user
  date: string; // YYYY-MM-DD (in effective tz)
  messages_count: number;
  uploads_count: number;
  updated_at: string | null;
};

function nowIso() {
  return new Date().toISOString();
}

/**
 * Drift-safe schema for usage_daily.
 *
 * Canonical goal:
 * - Track per-agency and (optionally) per-user usage per day.
 *
 * This function MUST be safe to run on old DBs and new DBs.
 */
export async function ensureUsageDailySchema(db: Db) {
  // Base table (older schemas may already exist with fewer columns)
  await db
    .run(
      `
      CREATE TABLE IF NOT EXISTS usage_daily (
        agency_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        date TEXT NOT NULL,
        messages_count INTEGER NOT NULL DEFAULT 0,
        uploads_count INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT
      )
    `
    )
    .catch(() => {});

  // Columns (drift-safe)
  await db.run(`ALTER TABLE usage_daily ADD COLUMN user_id TEXT`).catch(() => {});
  await db.run(`ALTER TABLE usage_daily ADD COLUMN messages_count INTEGER NOT NULL DEFAULT 0`).catch(() => {});
  await db.run(`ALTER TABLE usage_daily ADD COLUMN uploads_count INTEGER NOT NULL DEFAULT 0`).catch(() => {});
  await db.run(`ALTER TABLE usage_daily ADD COLUMN updated_at TEXT`).catch(() => {});

  // Backfill user_id for legacy rows (agency-only historical usage)
  // We use a stable sentinel so existing data keeps working.
  await db
    .run(
      `
      UPDATE usage_daily
      SET user_id = '__agency__'
      WHERE user_id IS NULL OR user_id = '';
    `
    )
    .catch(() => {});

  // Indexes (safe)
  await db
    .run(
      `CREATE INDEX IF NOT EXISTS idx_usage_daily_agency_user_date ON usage_daily(agency_id, user_id, date)`
    )
    .catch(() => {});
  await db.run(`CREATE INDEX IF NOT EXISTS idx_usage_daily_agency_date ON usage_daily(agency_id, date)`).catch(() => {});
}

/**
 * Fetch usage row for a given agency + day.
 * If your app is currently agency-scoped, we store in user_id='__agency__'.
 */
export async function getUsageRow(db: Db, agencyId: string, dateKey: string): Promise<UsageDailyRow> {
  await ensureUsageDailySchema(db);

  const row = (await db.get(
    `SELECT agency_id, user_id, date, messages_count, uploads_count, updated_at
     FROM usage_daily
     WHERE agency_id = ? AND user_id = '__agency__' AND date = ?
     LIMIT 1`,
    agencyId,
    dateKey
  )) as UsageDailyRow | undefined;

  if (row?.agency_id) {
    return {
      agency_id: String(row.agency_id),
      user_id: String((row as any).user_id ?? "__agency__"),
      date: String(row.date),
      messages_count: Number((row as any).messages_count ?? 0),
      uploads_count: Number((row as any).uploads_count ?? 0),
      updated_at: (row as any).updated_at ?? null,
    };
  }

  // Create row
  const t = nowIso();
  await db.run(
    `INSERT INTO usage_daily (agency_id, user_id, date, messages_count, uploads_count, updated_at)
     VALUES (?, '__agency__', ?, 0, 0, ?)`,
    agencyId,
    dateKey,
    t
  );

  return {
    agency_id: agencyId,
    user_id: "__agency__",
    date: dateKey,
    messages_count: 0,
    uploads_count: 0,
    updated_at: t,
  };
}

/**
 * Increment message usage for agency/day.
 */
export async function incrementMessages(db: Db, agencyId: string, dateKey: string, delta = 1) {
  await ensureUsageDailySchema(db);
  const t = nowIso();

  await db.run(
    `
    UPDATE usage_daily
    SET messages_count = COALESCE(messages_count, 0) + ?,
        updated_at = ?
    WHERE agency_id = ? AND user_id = '__agency__' AND date = ?;
  `,
    Number(delta),
    t,
    agencyId,
    dateKey
  );

  // If row didn't exist, create it and try again
  const row = (await db.get(
    `SELECT 1 as ok
     FROM usage_daily
     WHERE agency_id = ? AND user_id = '__agency__' AND date = ?
     LIMIT 1`,
    agencyId,
    dateKey
  )) as { ok?: number } | undefined;

  if (!row?.ok) {
    await db.run(
      `INSERT INTO usage_daily (agency_id, user_id, date, messages_count, uploads_count, updated_at)
       VALUES (?, '__agency__', ?, ?, 0, ?)`,
      agencyId,
      dateKey,
      Number(delta),
      t
    );
  }
}

/**
 * Increment upload usage for agency/day.
 */
export async function incrementUploads(db: Db, agencyId: string, dateKey: string, delta = 1) {
  await ensureUsageDailySchema(db);
  const t = nowIso();

  await db.run(
    `
    UPDATE usage_daily
    SET uploads_count = COALESCE(uploads_count, 0) + ?,
        updated_at = ?
    WHERE agency_id = ? AND user_id = '__agency__' AND date = ?;
  `,
    Number(delta),
    t,
    agencyId,
    dateKey
  );

  const row = (await db.get(
    `SELECT 1 as ok
     FROM usage_daily
     WHERE agency_id = ? AND user_id = '__agency__' AND date = ?
     LIMIT 1`,
    agencyId,
    dateKey
  )) as { ok?: number } | undefined;

  if (!row?.ok) {
    await db.run(
      `INSERT INTO usage_daily (agency_id, user_id, date, messages_count, uploads_count, updated_at)
       VALUES (?, '__agency__', ?, 0, ?, ?)`,
      agencyId,
      dateKey,
      Number(delta),
      t
    );
  }
}