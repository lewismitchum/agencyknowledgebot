// app/api/me/timezone/route.ts
import type { NextRequest } from "next/server";
import { getDb, type Db } from "@/lib/db";
import { ensureSchema } from "@/lib/schema";
import { requireActiveMember } from "@/lib/authz";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function ensureUserTimezoneColumns(db: Db) {
  // drift-safe
  await db.run(`ALTER TABLE users ADD COLUMN timezone TEXT`).catch(() => {});
  await db.run(`ALTER TABLE users ADD COLUMN timezone_updated_at TEXT`).catch(() => {});
}

function isValidIanaTz(tz: string) {
  // Stronger than "looks like": uses Intl to validate the timezone exists on this runtime.
  // Accepts e.g. "America/Chicago", "Europe/London", "Etc/UTC".
  if (!tz) return false;
  if (tz.length < 3 || tz.length > 64) return false;
  if (tz.includes(" ")) return false;

  try {
    // Throws RangeError for invalid timeZone in most runtimes.
    new Intl.DateTimeFormat("en-US", { timeZone: tz }).format(new Date());
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

    const body = (await req.json().catch(() => null)) as { timezone?: unknown } | null;
    const tz = String(body?.timezone ?? "").trim();

    if (!isValidIanaTz(tz)) {
      return Response.json({ ok: false, error: "INVALID_TIMEZONE" }, { status: 400 });
    }

    // Only update if changed (keeps writes low)
    const existing = (await db.get(
      `SELECT timezone
       FROM users
       WHERE id = ? AND agency_id = ?
       LIMIT 1`,
      ctx.userId,
      ctx.agencyId
    )) as { timezone?: string | null } | undefined;

    const cur = String(existing?.timezone ?? "").trim();

    if (cur === tz) {
      return Response.json({ ok: true, timezone: tz, changed: false });
    }

    await db.run(
      `UPDATE users
       SET timezone = ?, timezone_updated_at = ?
       WHERE id = ? AND agency_id = ?`,
      tz,
      new Date().toISOString(),
      ctx.userId,
      ctx.agencyId
    );

    return Response.json({ ok: true, timezone: tz, changed: true });
  } catch (err: any) {
    const msg = String(err?.code ?? err?.message ?? err);
    if (msg === "UNAUTHENTICATED") return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    if (msg === "FORBIDDEN_NOT_ACTIVE") return Response.json({ ok: false, error: "Forbidden" }, { status: 403 });
    return Response.json({ ok: false, error: "Server error", message: msg }, { status: 500 });
  }
}