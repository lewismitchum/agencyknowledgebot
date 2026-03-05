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

function isMissingUserIdColumnError(err: any) {
  const msg = String(err?.message ?? err);
  return msg.includes("no such column: user_id");
}

/**
 * Drift-safe schema for usage_daily.
 * Self-heals production drift where:
 * - usage_daily exists without user_id
 * - code attempts to create index on (agency_id, user_id, date)
 */
export async function ensureUsageDailySchema(db: Db) {
  // 1) Create table if missing (new installs)
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

  // 2) Drift-safe columns (older installs)
  await db.run(`ALTER TABLE usage_daily ADD COLUMN user_id TEXT`).catch(() => {});
  await db.run(`ALTER TABLE usage_daily ADD COLUMN messages_count INTEGER NOT NULL DEFAULT 0`).catch(() => {});
  await db.run(`ALTER TABLE usage_daily ADD COLUMN uploads_count INTEGER NOT NULL DEFAULT 0`).catch(() => {});
  await db.run(`ALTER TABLE usage_daily ADD COLUMN updated_at TEXT`).catch(() => {});

  // 3) Backfill user_id for legacy rows
  await db
    .run(
      `
      UPDATE usage_daily
      SET user_id = '__agency__'
      WHERE user_id IS NULL OR user_id = '';
    `
    )
    .catch(() => {});

  // 4) Indexes (self-healing)
  try {
    await db.run(
      `CREATE INDEX IF NOT EXISTS idx_usage_daily_agency_user_date ON usage_daily(agency_id, user_id, date)`
    );
  } catch (err: any) {
    if (isMissingUserIdColumnError(err)) {
      // Self-heal: add column, backfill, retry index
      await db.run(`ALTER TABLE usage_daily ADD COLUMN user_id TEXT`).catch(() => {});
      await db
        .run(
          `
          UPDATE usage_daily
          SET user_id = '__agency__'
          WHERE user_id IS NULL OR user_id = '';
        `
        )
        .catch(() => {});
      await db
        .run(
          `CREATE INDEX IF NOT EXISTS idx_usage_daily_agency_user_date ON usage_daily(agency_id, user_id, date)`
        )
        .catch(() => {});
    } else {
      throw err;
    }
  }

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