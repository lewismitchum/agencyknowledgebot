// lib/timezone.ts
import type { Db } from "@/lib/db";

async function ensureUserTimezoneColumns(db: Db) {
  await db.run(`ALTER TABLE users ADD COLUMN timezone TEXT`).catch(() => {});
  await db.run(`ALTER TABLE users ADD COLUMN timezone_updated_at TEXT`).catch(() => {});
}

function isLikelyIanaTz(tz: string) {
  // Accept IANA like "America/Chicago", "Europe/London", allow "Etc/UTC"
  if (!tz) return false;
  if (tz.length < 3 || tz.length > 64) return false;
  if (tz.includes(" ")) return false;
  if (tz === "Etc/UTC") return true;
  if (!tz.includes("/")) return false;
  return true;
}

function headerTimezone(headers?: Headers | null): string | null {
  if (!headers) return null;
  const raw = headers.get("x-user-timezone") || headers.get("X-User-Timezone") || "";
  const tz = String(raw || "").trim();
  if (!isLikelyIanaTz(tz)) return null;
  return tz;
}

export async function getEffectiveTimezone(
  db: Db,
  args: { agencyId: string; userId: string; headers?: Headers | null }
) {
  await ensureUserTimezoneColumns(db);

  // 0) Live timezone header (best for travel)
  const live = headerTimezone(args.headers);
  if (live) {
    // Persist if changed (keeps server reliable even if future calls miss header)
    const existing = (await db.get(
      `SELECT timezone
       FROM users
       WHERE id = ? AND agency_id = ?
       LIMIT 1`,
      args.userId,
      args.agencyId
    )) as { timezone?: string | null } | undefined;

    const cur = String(existing?.timezone ?? "").trim();
    if (cur !== live) {
      await db.run(
        `UPDATE users
         SET timezone = ?, timezone_updated_at = ?
         WHERE id = ? AND agency_id = ?`,
        live,
        new Date().toISOString(),
        args.userId,
        args.agencyId
      );
    }

    return live;
  }

  // 1) User timezone stored in DB
  const u = (await db.get(
    `SELECT timezone
     FROM users
     WHERE id = ? AND agency_id = ?
     LIMIT 1`,
    args.userId,
    args.agencyId
  )) as { timezone?: string | null } | undefined;

  const userTz = String(u?.timezone ?? "").trim();
  if (userTz) return userTz;

  // 2) Agency timezone
  const a = (await db.get(
    `SELECT timezone
     FROM agencies
     WHERE id = ?
     LIMIT 1`,
    args.agencyId
  )) as { timezone?: string | null } | undefined;

  const agencyTz = String(a?.timezone ?? "").trim();
  return agencyTz || "America/Chicago";
}

export function ymdInTz(date: Date, tz: string) {
  // en-CA => YYYY-MM-DD
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(date);
  } catch {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Chicago",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(date);
  }
}

export function timeStringInTz(date: Date, tz: string) {
  const time = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(date);

  const dateStr = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(date);

  return `It’s ${time} (${dateStr}).`;
}