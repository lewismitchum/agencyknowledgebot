// app/api/me/timezone/route.ts
import type { NextRequest } from "next/server";
import { getDb, type Db } from "@/lib/db";
import { ensureSchema } from "@/lib/schema";
import { requireActiveMember } from "@/lib/authz";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function ensureUserTimezoneColumns(db: Db) {
  // canonical
  await db.run(`ALTER TABLE users ADD COLUMN time_zone TEXT`).catch(() => {});
  await db.run(`ALTER TABLE users ADD COLUMN time_zone_updated_at TEXT`).catch(() => {});

  // legacy drift safety
  await db.run(`ALTER TABLE users ADD COLUMN timezone TEXT`).catch(() => {});
  await db.run(`ALTER TABLE users ADD COLUMN timezone_updated_at TEXT`).catch(() => {});

  // backfill canonical from legacy
  await db.run(`
    UPDATE users
    SET time_zone = timezone
    WHERE (time_zone IS NULL OR time_zone = '')
      AND timezone IS NOT NULL
      AND timezone <> '';
  `).catch(() => {});
}

function isValidIanaTz(tz: string) {
  if (!tz) return false;
  const t = String(tz).trim();
  if (t.length < 3 || t.length > 64) return false;
  if (t.includes(" ")) return false;

  try {
    new Intl.DateTimeFormat("en-US", { timeZone: t }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireActiveMember(req);

    const db: Db = await getDb();
    await ensureSchema(db);
    await ensureUserTimezoneColumns(db);

    const body = (await req.json().catch(() => null)) as
      | { timezone?: unknown; time_zone?: unknown; timeZone?: unknown }
      | null;

    // ✅ accept all common keys (your client currently sends { time_zone })
    const tz = String(body?.time_zone ?? body?.timezone ?? body?.timeZone ?? "").trim();

    if (!isValidIanaTz(tz)) {
      return Response.json({ ok: false, error: "INVALID_TIMEZONE" }, { status: 400 });
    }

    const existing = (await db.get(
      `SELECT time_zone
       FROM users
       WHERE id = ? AND agency_id = ?
       LIMIT 1`,
      ctx.userId,
      ctx.agencyId
    )) as { time_zone?: string | null } | undefined;

    const cur = String(existing?.time_zone ?? "").trim();

    if (cur === tz) {
      return Response.json({ ok: true, timezone: tz, time_zone: tz, changed: false });
    }

    await db.run(
      `UPDATE users
       SET time_zone = ?, time_zone_updated_at = ?
       WHERE id = ? AND agency_id = ?`,
      tz,
      new Date().toISOString(),
      ctx.userId,
      ctx.agencyId
    );

    return Response.json({ ok: true, timezone: tz, time_zone: tz, changed: true });
  } catch (err: any) {
    const msg = String(err?.code ?? err?.message ?? err);
    if (msg === "UNAUTHENTICATED") return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    if (msg === "FORBIDDEN_NOT_ACTIVE") return Response.json({ ok: false, error: "Forbidden" }, { status: 403 });
    return Response.json({ ok: false, error: "Server error", message: msg }, { status: 500 });
  }
}