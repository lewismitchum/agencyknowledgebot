// lib/usage.ts
import type { Db } from "@/lib/db";

export type UsageDailyRow = {
  agency_id: string;
  user_id: string; // supports per-user usage; legacy uses '__agency__'
  date: string; // YYYY-MM-DD
  messages_count: number;
  uploads_count: number;
  updated_at: string | null;
};

function nowIso() {
  return new Date().toISOString();
}

/**
 * Drift-safe schema for usage_daily.
 * Fixes production drift where the table existed without user_id but code created an index using it.
 */
export async function ensureUsageDailySchema(db: Db) {
  // Create table if missing (includes user_id)
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

  // Drift-safe columns
  await db.run(`ALTER TABLE usage_daily ADD COLUMN user_id TEXT`).catch(() => {});
  await db.run(`ALTER TABLE usage_daily ADD COLUMN messages_count INTEGER NOT NULL DEFAULT 0`).catch(() => {});
  await db.run(`ALTER TABLE usage_daily ADD COLUMN uploads_count INTEGER NOT NULL DEFAULT 0`).catch(() => {});
  await db.run(`ALTER TABLE usage_daily ADD COLUMN updated_at TEXT`).catch(() => {});

  // Backfill user_id for legacy rows (agency-only)
  await db
    .run(
      `
      UPDATE usage_daily
      SET user_id = '__agency__'
      WHERE user_id IS NULL OR user_id = '';
    `
    )
    .catch(() => {});

  // Indexes
  await db
    .run(`CREATE INDEX IF NOT EXISTS idx_usage_daily_agency_user_date ON usage_daily(agency_id, user_id, date)`)
    .catch(() => {});
  await db.run(`CREATE INDEX IF NOT EXISTS idx_usage_daily_agency_date ON usage_daily(agency_id, date)`).catch(() => {});
}

/**
 * Canonical: agency-scoped row (legacy behavior) using user_id='__agency__'
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

export async function incrementMessages(db: Db, agencyId: string, dateKey: string, delta = 1) {
  await ensureUsageDailySchema(db);
  const t = nowIso();

  // Ensure row exists
  await getUsageRow(db, agencyId, dateKey);

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
}

export async function incrementUploads(db: Db, agencyId: string, dateKey: string, delta = 1) {
  await ensureUsageDailySchema(db);
  const t = nowIso();

  // Ensure row exists
  await getUsageRow(db, agencyId, dateKey);

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
}

/**
 * ✅ Back-compat export: older routes import incrementUsage().
 * We keep the signature flexible and route to the correct counter.
 *
 * Supported call styles:
 * - incrementUsage(db, agencyId, dateKey, "messages", 1)
 * - incrementUsage(db, agencyId, dateKey, "uploads", 1)
 * - incrementUsage(db, agencyId, dateKey, 1)  // defaults to messages
 */
export async function incrementUsage(
  db: Db,
  agencyId: string,
  dateKey: string,
  kindOrDelta: "messages" | "uploads" | number = "messages",
  maybeDelta?: number
) {
  if (kindOrDelta === "uploads") {
    return incrementUploads(db, agencyId, dateKey, Number(maybeDelta ?? 1));
  }

  if (kindOrDelta === "messages") {
    return incrementMessages(db, agencyId, dateKey, Number(maybeDelta ?? 1));
  }

  // kindOrDelta is a number => delta for messages
  return incrementMessages(db, agencyId, dateKey, Number(kindOrDelta ?? 1));
}