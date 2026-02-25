// app/api/schedule/timezone/route.ts
import type { NextRequest } from "next/server";
import { getDb, type Db } from "@/lib/db";
import { requireActiveMember } from "@/lib/authz";
import { ensureSchema } from "@/lib/schema";

export const runtime = "nodejs";

function safeTz(tz: any) {
  const s = String(tz || "").trim();
  return s || "America/Chicago";
}

function dayKeyInTz(d: Date, tz: string) {
  // YYYY-MM-DD
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

export async function OPTIONS() {
  return new Response(null, { status: 204 });
}

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireActiveMember(req);
    const db: Db = await getDb();
    await ensureSchema(db);

    const row = (await db.get(
      `SELECT timezone
       FROM agencies
       WHERE id = ?
       LIMIT 1`,
      ctx.agencyId
    )) as { timezone?: string | null } | undefined;

    const timezone = safeTz(row?.timezone);
    const today = dayKeyInTz(new Date(), timezone);

    return Response.json({ ok: true, timezone, today });
  } catch (err) {
    console.error("SCHEDULE_TIMEZONE_GET_ERROR", err);
    return Response.json({ ok: false, error: "SERVER_ERROR" }, { status: 500 });
  }
}