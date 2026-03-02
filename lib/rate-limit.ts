import { getDb } from "@/lib/db";

type Options = {
  userId: string;
  agencyId: string;
  key: string;
  perMinute: number;
  perHour: number;
};

export async function enforceRateLimit(opts: Options) {
  const db = await getDb();

  // Drift-safe table
  await db.exec(`
    CREATE TABLE IF NOT EXISTS rate_limits (
      user_id TEXT NOT NULL,
      agency_id TEXT NOT NULL,
      key TEXT NOT NULL,
      minute_bucket INTEGER NOT NULL,
      hour_bucket INTEGER NOT NULL,
      minute_count INTEGER NOT NULL DEFAULT 0,
      hour_count INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (user_id, agency_id, key)
    );
  `);

  const now = Date.now();
  const minuteBucket = Math.floor(now / 60000);
  const hourBucket = Math.floor(now / 3600000);

  const row = await db.get(
    `SELECT minute_bucket, hour_bucket, minute_count, hour_count
     FROM rate_limits
     WHERE user_id = ? AND agency_id = ? AND key = ?`,
    [opts.userId, opts.agencyId, opts.key]
  );

  let minuteCount = 0;
  let hourCount = 0;

  if (!row) {
    await db.run(
      `INSERT INTO rate_limits
       (user_id, agency_id, key, minute_bucket, hour_bucket, minute_count, hour_count)
       VALUES (?, ?, ?, ?, ?, 0, 0)`,
      [opts.userId, opts.agencyId, opts.key, minuteBucket, hourBucket]
    );
  } else {
    minuteCount = row.minute_bucket === minuteBucket ? row.minute_count : 0;
    hourCount = row.hour_bucket === hourBucket ? row.hour_count : 0;
  }

  if (minuteCount >= opts.perMinute) {
    throw new Error("Too many requests this minute.");
  }

  if (hourCount >= opts.perHour) {
    throw new Error("Hourly limit reached.");
  }

  await db.run(
    `UPDATE rate_limits
     SET minute_bucket = ?,
         hour_bucket = ?,
         minute_count = ?,
         hour_count = ?
     WHERE user_id = ? AND agency_id = ? AND key = ?`,
    [
      minuteBucket,
      hourBucket,
      minuteCount + 1,
      hourCount + 1,
      opts.userId,
      opts.agencyId,
      opts.key,
    ]
  );
} export { enforceRateLimit as rateLimit };