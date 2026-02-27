// lib/usage.ts
import type { Db } from "@/lib/db";

export type UsageKind = "messages" | "uploads";

/**
 * Your existing routes use usage_daily(agency_id, date, messages_count, uploads_count)
 * where "date" is a YYYY-MM-DD string (computed in agency timezone).
 *
 * This file hardens schema drift and provides:
 * - ensureUsageDailySchema
 * - getUsageRow
 * - incrementUsage
 */

export async function ensureUsageDailySchema(db: Db) {
  await db
    .run(
      `CREATE TABLE IF NOT EXISTS usage_daily (
        agency_id TEXT NOT NULL,
        date TEXT NOT NULL,
        messages_count INTEGER NOT NULL DEFAULT 0,
        uploads_count INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (agency_id, date)
      )`
    )
    .catch(() => {});

  await db.run("ALTER TABLE usage_daily ADD COLUMN date TEXT").catch(() => {});
  await db.run("ALTER TABLE usage_daily ADD COLUMN messages_count INTEGER NOT NULL DEFAULT 0").catch(() => {});
  await db.run("ALTER TABLE usage_daily ADD COLUMN uploads_count INTEGER NOT NULL DEFAULT 0").catch(() => {});
}

export async function ensureUsageRow(db: Db, agencyId: string, dateKey: string) {
  await ensureUsageDailySchema(db);

  await db.run(
    `INSERT OR IGNORE INTO usage_daily (agency_id, date, messages_count, uploads_count)
     VALUES (?, ?, 0, 0)`,
    agencyId,
    dateKey
  );
}

export async function getUsageRow(db: Db, agencyId: string, dateKey: string) {
  await ensureUsageRow(db, agencyId, dateKey);

  const row = (await db.get(
    `SELECT agency_id, date, messages_count, uploads_count
     FROM usage_daily
     WHERE agency_id = ? AND date = ?
     LIMIT 1`,
    agencyId,
    dateKey
  )) as
    | { agency_id: string; date: string; messages_count: number; uploads_count: number }
    | undefined;

  if (row) {
    return {
      agency_id: String(row.agency_id),
      date: String(row.date),
      messages_count: Number(row.messages_count ?? 0),
      uploads_count: Number(row.uploads_count ?? 0),
    };
  }

  return { agency_id: agencyId, date: dateKey, messages_count: 0, uploads_count: 0 };
}

export async function incrementUsage(
  db: Db,
  agencyId: string,
  dateKey: string,
  kind: UsageKind,
  delta = 1
) {
  await ensureUsageRow(db, agencyId, dateKey);

  if (kind === "messages") {
    await db.run(
      `UPDATE usage_daily
       SET messages_count = COALESCE(messages_count, 0) + ?
       WHERE agency_id = ? AND date = ?`,
      delta,
      agencyId,
      dateKey
    );
  } else {
    await db.run(
      `UPDATE usage_daily
       SET uploads_count = COALESCE(uploads_count, 0) + ?
       WHERE agency_id = ? AND date = ?`,
      delta,
      agencyId,
      dateKey
    );
  }

  return getUsageRow(db, agencyId, dateKey);
}