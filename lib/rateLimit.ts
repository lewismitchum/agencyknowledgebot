import { getDb } from "@/lib/db";

type RateLimitResult =
  | { ok: true; remaining: number }
  | { ok: false; retryAfterSeconds: number };

export async function rateLimitOrThrow(opts: {
  key: string;
  limit: number;    // e.g. 20
  windowMs: number; // e.g. 60_000
}): Promise<RateLimitResult> {
  const db = await getDb();

  const now = Date.now();
  const windowStart = Math.floor(now / opts.windowMs) * opts.windowMs;

  // Load existing counter
  const row = await db.get<{
    window_start: number;
    count: number;
  }>(
    `SELECT window_start, count
     FROM rate_limits
     WHERE key = ?`,
    opts.key
  );

  // If none, insert fresh
  if (!row) {
    await db.run(
      `INSERT INTO rate_limits (key, window_start, count)
       VALUES (?, ?, ?)`,
      opts.key,
      windowStart,
      1
    );

    return { ok: true, remaining: opts.limit - 1 };
  }

  // If window expired, reset
  if (row.window_start !== windowStart) {
    await db.run(
      `UPDATE rate_limits
       SET window_start = ?, count = ?
       WHERE key = ?`,
      windowStart,
      1,
      opts.key
    );

    return { ok: true, remaining: opts.limit - 1 };
  }

  // Same window: block if over limit
  if (row.count >= opts.limit) {
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((row.window_start + opts.windowMs - now) / 1000)
    );

    return { ok: false, retryAfterSeconds };
  }

  // Same window: increment
  await db.run(
    `UPDATE rate_limits
     SET count = count + 1
     WHERE key = ?`,
    opts.key
  );

  return { ok: true, remaining: opts.limit - (row.count + 1) };
}
