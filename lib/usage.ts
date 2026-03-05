// lib/usage.ts
import type { Db } from "@/lib/db";

export type UsageDailyRow = {
  agency_id: string;
  user_id: string; // canonical per-user
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
 * Canonical:
 * - PRIMARY KEY (agency_id, user_id, date)
 * - messages_count, uploads_count
 */
export async function ensureUsageDailySchema(db: Db) {
  // Table (new installs)
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

  // Columns (drift-safe)
  await db.run(`ALTER TABLE usage_daily ADD COLUMN user_id TEXT`).catch(() => {});
  await db.run(`ALTER TABLE usage_daily ADD COLUMN messages_count INTEGER NOT NULL DEFAULT 0`).catch(() => {});
  await db.run(`ALTER TABLE usage_daily ADD COLUMN uploads_count INTEGER NOT NULL DEFAULT 0`).catch(() => {});
  await db.run(`ALTER TABLE usage_daily ADD COLUMN updated_at TEXT`).catch(() => {});

  // Backfill (legacy rows)
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
  try {
    await db.run(
      `CREATE INDEX IF NOT EXISTS idx_usage_daily_agency_user_date ON usage_daily(agency_id, user_id, date)`
    );
  } catch (err: any) {
    if (isMissingUserIdColumnError(err)) {
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
        .run(`CREATE INDEX IF NOT EXISTS idx_usage_daily_agency_user_date ON usage_daily(agency_id, user_id, date)`)
        .catch(() => {});
    } else {
      throw err;
    }
  }

  await db.run(`CREATE INDEX IF NOT EXISTS idx_usage_daily_agency_date ON usage_daily(agency_id, date)`).catch(() => {});
}

/**
 * ✅ Canonical per-user usage row
 */
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
    agencyId,
    userId,
    dateKey
  )) as UsageDailyRow | undefined;

  if (row?.agency_id) {
    return {
      agency_id: String(row.agency_id),
      user_id: String((row as any).user_id ?? userId),
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
    agencyId,
    userId,
    dateKey,
    t
  );

  return {
    agency_id: agencyId,
    user_id: userId,
    date: dateKey,
    messages_count: 0,
    uploads_count: 0,
    updated_at: t,
  };
}

export async function incrementUserMessages(db: Db, agencyId: string, userId: string, dateKey: string, delta = 1) {
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
    agencyId,
    userId,
    dateKey
  );
}

export async function incrementUserUploads(db: Db, agencyId: string, userId: string, dateKey: string, delta = 1) {
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
    agencyId,
    userId,
    dateKey
  );
}

/**
 * ===== Legacy/back-compat (agency-wide row) =====
 * Kept so older routes don’t crash, but new code should use per-user functions above.
 */
export async function getUsageRow(db: Db, agencyId: string, dateKey: string): Promise<UsageDailyRow> {
  return getUserUsageRow(db, agencyId, "__agency__", dateKey);
}

export async function incrementMessages(db: Db, agencyId: string, dateKey: string, delta = 1) {
  return incrementUserMessages(db, agencyId, "__agency__", dateKey, delta);
}

export async function incrementUploads(db: Db, agencyId: string, dateKey: string, delta = 1) {
  return incrementUserUploads(db, agencyId, "__agency__", dateKey, delta);
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
  return incrementMessages(db, agencyId, dateKey, Number(kindOrDelta ?? 1));
}