// lib/rate-limit.ts
import { getDb } from "@/lib/db";

type RateLimitInput = {
  userId: string;
  agencyId: string;
  key: string;
  perMinute: number;
  perHour: number;
};

function nowMs() {
  return Date.now();
}

function floorToMinute(ms: number) {
  return Math.floor(ms / 60000) * 60000;
}

function floorToHour(ms: number) {
  return Math.floor(ms / 3600000) * 3600000;
}

/**
 * Turso/libSQL wrappers vary:
 * - some expect db.get(sql, ...args) / db.run(sql, ...args)
 * - others expect db.get(sql, argsArray) / db.run(sql, argsArray)
 *
 * These adapters support both without touching your global db wrapper.
 */
async function dbGet(db: any, sql: string, args: any[]) {
  try {
    return await db.get(sql, ...args);
  } catch (err: any) {
    const msg = String(err?.message || "");
    if (msg.includes("Number of arguments mismatch") || msg.includes("expected") || msg.includes("mismatch")) {
      return await db.get(sql, args);
    }
    throw err;
  }
}

async function dbRun(db: any, sql: string, args: any[]) {
  try {
    return await db.run(sql, ...args);
  } catch (err: any) {
    const msg = String(err?.message || "");
    if (msg.includes("Number of arguments mismatch") || msg.includes("expected") || msg.includes("mismatch")) {
      return await db.run(sql, args);
    }
    throw err;
  }
}

export async function enforceRateLimit(input: RateLimitInput) {
  const { userId, agencyId, key, perMinute, perHour } = input;

  if (!userId || !agencyId || !key) return;
  if (!Number.isFinite(perMinute) || perMinute <= 0) return;
  if (!Number.isFinite(perHour) || perHour <= 0) return;

  const db = await getDb();

  // Drift-safe table
  await db.exec(`
    CREATE TABLE IF NOT EXISTS rate_limits (
      agency_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      key TEXT NOT NULL,

      minute_window_start INTEGER NOT NULL,
      minute_count INTEGER NOT NULL,

      hour_window_start INTEGER NOT NULL,
      hour_count INTEGER NOT NULL,

      updated_at INTEGER NOT NULL,

      PRIMARY KEY (agency_id, user_id, key)
    );

    CREATE INDEX IF NOT EXISTS idx_rate_limits_updated
      ON rate_limits(updated_at);
  `);

  const t = nowMs();
  const minuteStart = floorToMinute(t);
  const hourStart = floorToHour(t);

  // Fetch existing counters
  const row = await dbGet(
    db,
    `
    SELECT
      minute_window_start,
      minute_count,
      hour_window_start,
      hour_count
    FROM rate_limits
    WHERE agency_id = ? AND user_id = ? AND key = ?
    `,
    [agencyId, userId, key],
  );

  let nextMinuteStart = minuteStart;
  let nextMinuteCount = 1;

  let nextHourStart = hourStart;
  let nextHourCount = 1;

  if (row) {
    const prevMinuteStart = Number(row.minute_window_start || 0);
    const prevMinuteCount = Number(row.minute_count || 0);

    const prevHourStart = Number(row.hour_window_start || 0);
    const prevHourCount = Number(row.hour_count || 0);

    if (prevMinuteStart === minuteStart) {
      nextMinuteStart = prevMinuteStart;
      nextMinuteCount = prevMinuteCount + 1;
    }

    if (prevHourStart === hourStart) {
      nextHourStart = prevHourStart;
      nextHourCount = prevHourCount + 1;
    }
  }

  // Enforce limits BEFORE writing
  if (nextMinuteCount > perMinute) {
    throw new Error("Too many requests. Please slow down.");
  }
  if (nextHourCount > perHour) {
    throw new Error("Hourly limit reached. Try again later.");
  }

  // Upsert counters
  await dbRun(
    db,
    `
    INSERT INTO rate_limits (
      agency_id, user_id, key,
      minute_window_start, minute_count,
      hour_window_start, hour_count,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(agency_id, user_id, key) DO UPDATE SET
      minute_window_start = excluded.minute_window_start,
      minute_count = excluded.minute_count,
      hour_window_start = excluded.hour_window_start,
      hour_count = excluded.hour_count,
      updated_at = excluded.updated_at
    `,
    [
      agencyId,
      userId,
      key,
      nextMinuteStart,
      nextMinuteCount,
      nextHourStart,
      nextHourCount,
      t,
    ],
  );
}