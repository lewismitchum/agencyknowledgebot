// lib/usage.ts
import type { Db } from "@/lib/db";

export type UsageDailyRow = {
  agency_id: string;
  user_id: string; // per-user usage row
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
 * Canonical: per-user PK (agency_id, user_id, date)
 */
export async function ensureUsageDailySchema(db: Db) {
  // 1) Create table if missing
  await db
    .run(
      `
      CREATE TABLE IF NOT EXISTS usage_daily (
        agency_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        date TEXT NOT NULL,
        messages_count INTEGER NOT NULL DEFAULT 0,
        uploads_count INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT,
        PRIMARY KEY (agency_id, user_id, date)
      )
    `
    )
    .catch(() => {});

  // 2) Drift-safe columns (older installs)
  await db.run(`ALTER TABLE usage_daily ADD COLUMN user_id TEXT`).catch(() => {});
  await db.run(`ALTER TABLE usage_daily ADD COLUMN messages_count INTEGER NOT NULL DEFAULT 0`).catch(() => {});
  await db.run(`ALTER TABLE usage_daily ADD COLUMN uploads_count INTEGER NOT NULL DEFAULT 0`).catch(() => {});
  await db.run(`ALTER TABLE usage_daily ADD COLUMN updated_at TEXT`).catch(() => {});

  // 3) Backfill any NULL/empty user_id rows (legacy -> keep but isolate)
  await db
    .run(
      `
      UPDATE usage_daily
      SET user_id = ''
      WHERE user_id IS NULL;
    `
    )
    .catch(() => {});

  // 4) Indexes
  await db
    .run(`CREATE INDEX IF NOT EXISTS idx_usage_daily_agency_user_date ON usage_daily(agency_id, user_id, date)`)
    .catch(() => {});
  await db.run(`CREATE INDEX IF NOT EXISTS idx_usage_daily_agency_date ON usage_daily(agency_id, date)`).catch(() => {});
}

export async function getUserUsageRow(
  db: Db,
  agencyId: string,
  userId: string,
  dateKey: string
): Promise<UsageDailyRow> {
  await ensureUsageDailySchema(db);

  const row = (await db.get(
    `SELECT agency_id, user_id, date, messages_count, uploads_count, updated_at
     FROM usage_daily
     WHERE agency_id = ? AND user_id = ? AND date = ?
     LIMIT 1`,
    String(agencyId),
    String(userId),
    String(dateKey)
  )) as UsageDailyRow | undefined;

  if (row?.agency_id) {
    return {
      agency_id: String(row.agency_id),
      user_id: String(row.user_id),
      date: String(row.date),
      messages_count: Number((row as any).messages_count ?? 0),
      uploads_count: Number((row as any).uploads_count ?? 0),
      updated_at: (row as any).updated_at ?? null,
    };
  }

  const t = nowIso();
  await db.run(
    `INSERT INTO usage_daily (agency_id, user_id, date, messages_count, uploads_count, updated_at)
     VALUES (?, ?, ?, 0, 0, ?)`,
    String(agencyId),
    String(userId),
    String(dateKey),
    t
  );

  return {
    agency_id: String(agencyId),
    user_id: String(userId),
    date: String(dateKey),
    messages_count: 0,
    uploads_count: 0,
    updated_at: t,
  };
}

export async function incrementUserMessages(
  db: Db,
  agencyId: string,
  userId: string,
  dateKey: string,
  delta = 1
) {
  await ensureUsageDailySchema(db);
  const t = nowIso();

  await getUserUsageRow(db, agencyId, userId, dateKey);

  await db.run(
    `
    UPDATE usage_daily
    SET messages_count = COALESCE(messages_count, 0) + ?,
        updated_at = ?
    WHERE agency_id = ? AND user_id = ? AND date = ?;
  `,
    Number(delta),
    t,
    String(agencyId),
    String(userId),
    String(dateKey)
  );
}

export async function incrementUserUploads(
  db: Db,
  agencyId: string,
  userId: string,
  dateKey: string,
  delta = 1
) {
  await ensureUsageDailySchema(db);
  const t = nowIso();

  await getUserUsageRow(db, agencyId, userId, dateKey);

  await db.run(
    `
    UPDATE usage_daily
    SET uploads_count = COALESCE(uploads_count, 0) + ?,
        updated_at = ?
    WHERE agency_id = ? AND user_id = ? AND date = ?;
  `,
    Number(delta),
    t,
    String(agencyId),
    String(userId),
    String(dateKey)
  );
}

/**
 * Back-compat: agency-scoped usage row (legacy callers).
 * We store it under user_id='__agency__'.
 */
export async function getUsageRow(db: Db, agencyId: string, dateKey: string): Promise<UsageDailyRow> {
  return getUserUsageRow(db, agencyId, "__agency__", dateKey);
}

/**
 * Back-compat increments (legacy callers).
 */
export async function incrementMessages(db: Db, agencyId: string, dateKey: string, delta = 1) {
  return incrementUserMessages(db, agencyId, "__agency__", dateKey, delta);
}

export async function incrementUploads(db: Db, agencyId: string, dateKey: string, delta = 1) {
  return incrementUserUploads(db, agencyId, "__agency__", dateKey, delta);
}

/**
 * Back-compat export: older routes import incrementUsage().
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

  return incrementMessages(db, agencyId, dateKey, Number(kindOrDelta ?? 1));
}