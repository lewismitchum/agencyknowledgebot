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
 * - some expect db.get/sql run(sql, ...args)
 * - others expect db.get/sql run(sql, argsArray)
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

async function dbAll(db: any, sql: string, args: any[] = []) {
  try {
    return await db.all(sql, ...args);
  } catch (err: any) {
    const msg = String(err?.message || "");
    if (msg.includes("Number of arguments mismatch") || msg.includes("expected") || msg.includes("mismatch")) {
      return await db.all(sql, args);
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

type RateLimitSchema = {
  hasMinuteBucket: boolean;
  hasHourBucket: boolean;
  hasMinuteWindowStart: boolean;
  hasHourWindowStart: boolean;
  hasUpdatedAt: boolean;
};

async function ensureRateLimitSchema(db: any): Promise<RateLimitSchema> {
  // Do NOT attempt to fully rewrite existing table (Turso ALTER is fine; DROP is risky).
  // Create if missing with the "new" schema.
  await db.exec(`
    CREATE TABLE IF NOT EXISTS rate_limits (
      agency_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      key TEXT NOT NULL,
      minute_window_start INTEGER NOT NULL DEFAULT 0,
      minute_count INTEGER NOT NULL DEFAULT 0,
      hour_window_start INTEGER NOT NULL DEFAULT 0,
      hour_count INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (agency_id, user_id, key)
    );
  `);

  const cols = await dbAll(db, `PRAGMA table_info(rate_limits)`);
  const have = new Set((cols || []).map((c: any) => String(c?.name || "")));

  const schema: RateLimitSchema = {
    hasMinuteBucket: have.has("minute_bucket"),
    hasHourBucket: have.has("hour_bucket"),
    hasMinuteWindowStart: have.has("minute_window_start"),
    hasHourWindowStart: have.has("hour_window_start"),
    hasUpdatedAt: have.has("updated_at"),
  };

  // Drift-safe adds (only add what’s missing; never assume)
  if (!schema.hasUpdatedAt) {
    await db.exec(`ALTER TABLE rate_limits ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0;`);
    schema.hasUpdatedAt = true;
  }

  // If legacy uses *_bucket but is missing *_count, ensure counts exist too.
  if (schema.hasMinuteBucket && !have.has("minute_count")) {
    await db.exec(`ALTER TABLE rate_limits ADD COLUMN minute_count INTEGER NOT NULL DEFAULT 0;`);
  }
  if (schema.hasHourBucket && !have.has("hour_count")) {
    await db.exec(`ALTER TABLE rate_limits ADD COLUMN hour_count INTEGER NOT NULL DEFAULT 0;`);
  }

  // If new schema is partially missing, add it (safe).
  if (!schema.hasMinuteWindowStart && !schema.hasMinuteBucket) {
    await db.exec(`ALTER TABLE rate_limits ADD COLUMN minute_window_start INTEGER NOT NULL DEFAULT 0;`);
    schema.hasMinuteWindowStart = true;
  }
  if (!schema.hasHourWindowStart && !schema.hasHourBucket) {
    await db.exec(`ALTER TABLE rate_limits ADD COLUMN hour_window_start INTEGER NOT NULL DEFAULT 0;`);
    schema.hasHourWindowStart = true;
  }

  // Index after updated_at exists
  await db.exec(`
    CREATE INDEX IF NOT EXISTS idx_rate_limits_updated
      ON rate_limits(updated_at);
  `);

  return schema;
}

export async function enforceRateLimit(input: RateLimitInput) {
  const { userId, agencyId, key, perMinute, perHour } = input;

  if (!userId || !agencyId || !key) return;
  if (!Number.isFinite(perMinute) || perMinute <= 0) return;
  if (!Number.isFinite(perHour) || perHour <= 0) return;

  const db = await getDb();
  const schema = await ensureRateLimitSchema(db);

  const t = nowMs();
  const minuteStart = floorToMinute(t);
  const hourStart = floorToHour(t);

  const minuteCol = schema.hasMinuteBucket ? "minute_bucket" : "minute_window_start";
  const hourCol = schema.hasHourBucket ? "hour_bucket" : "hour_window_start";

  // Read current counters
  const row = await dbGet(
    db,
    `
    SELECT
      ${minuteCol} as minute_start,
      minute_count as minute_count,
      ${hourCol} as hour_start,
      hour_count as hour_count
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
    const prevMinuteStart = Number(row.minute_start || 0);
    const prevMinuteCount = Number(row.minute_count || 0);

    const prevHourStart = Number(row.hour_start || 0);
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

  if (nextMinuteCount > perMinute) {
    throw new Error("Too many requests. Please slow down.");
  }
  if (nextHourCount > perHour) {
    throw new Error("Hourly limit reached. Try again later.");
  }

  // Upsert using the schema’s actual bucket/window columns
  await dbRun(
    db,
    `
    INSERT INTO rate_limits (
      agency_id, user_id, key,
      ${minuteCol}, minute_count,
      ${hourCol}, hour_count,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(agency_id, user_id, key) DO UPDATE SET
      ${minuteCol} = excluded.${minuteCol},
      minute_count = excluded.minute_count,
      ${hourCol} = excluded.${hourCol},
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