import { getDb, type Db } from "@/lib/db";

/**
 * usage_daily schema has existed in multiple versions:
 * - v1: (agency_id, day, count)
 * - v2: (agency_id, date, messages_count, uploads_count)
 *
 * This helper upgrades safely in-place (best effort).
 */
export async function ensureUsageDaily(db?: Db) {
  const _db: Db = db ?? (await getDb());

  // Ensure table exists (v2 shape)
  await _db.run(
    `CREATE TABLE IF NOT EXISTS usage_daily (
      agency_id TEXT NOT NULL,
      date TEXT NOT NULL,
      messages_count INTEGER NOT NULL DEFAULT 0,
      uploads_count INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (agency_id, date)
    )`
  ).catch(() => {});

  // Add v2 columns if missing
  await _db.run(`ALTER TABLE usage_daily ADD COLUMN date TEXT`).catch(() => {});
  await _db.run(`ALTER TABLE usage_daily ADD COLUMN messages_count INTEGER NOT NULL DEFAULT 0`).catch(() => {});
  await _db.run(`ALTER TABLE usage_daily ADD COLUMN uploads_count INTEGER NOT NULL DEFAULT 0`).catch(() => {});

  // Backfill from legacy columns if they exist
  // (If they don't exist, these updates will fail — ignore.)
  await _db.run(
    `UPDATE usage_daily
     SET date = COALESCE(date, day)
     WHERE (date IS NULL OR date = '')`
  ).catch(() => {});

  await _db.run(
    `UPDATE usage_daily
     SET messages_count = COALESCE(messages_count, count)
     WHERE messages_count IS NULL OR messages_count = 0`
  ).catch(() => {});

  // Ensure we have a unique index for ON CONFLICT(agency_id, date)
  await _db.run(
    `CREATE UNIQUE INDEX IF NOT EXISTS usage_daily_agency_date_idx
     ON usage_daily(agency_id, date)`
  ).catch(() => {});
}
