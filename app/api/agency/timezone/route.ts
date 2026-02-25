// app/api/agency/timezone/route.ts
import type { NextRequest } from "next/server";
import { getDb, type Db } from "@/lib/db";
import { requireActiveMember } from "@/lib/authz";
import { ensureSchema } from "@/lib/schema";

export const runtime = "nodejs";

function safeTz(tz: any) {
  const s = String(tz || "").trim();
  return s || "America/Chicago";
}

function isValidTimeZone(tz: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

async function isOwner(db: Db, agencyId: string, userId: string) {
  const row = (await db.get(
    `SELECT role
     FROM users
     WHERE agency_id = ? AND id = ?
     LIMIT 1`,
    agencyId,
    userId
  )) as { role?: string | null } | undefined;

  return String(row?.role || "").toLowerCase() === "owner";
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

    return Response.json({ ok: true, timezone: safeTz(row?.timezone) });
  } catch (err) {
    console.error("AGENCY_TIMEZONE_GET_ERROR", err);
    return Response.json({ ok: false, error: "SERVER_ERROR" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireActiveMember(req);
    const db: Db = await getDb();
    await ensureSchema(db);

    const owner = await isOwner(db, ctx.agencyId, ctx.userId);
    if (!owner) {
      return Response.json({ ok: false, error: "FORBIDDEN", message: "Owner only" }, { status: 403 });
    }

    const body = (await req.json().catch(() => null)) as any;
    const tz = safeTz(body?.timezone);

    if (!isValidTimeZone(tz)) {
      return Response.json(
        { ok: false, error: "BAD_TIMEZONE", message: "Invalid IANA timezone" },
        { status: 400 }
      );
    }

    await db.run(`UPDATE agencies SET timezone = ? WHERE id = ?`, tz, ctx.agencyId);

    return Response.json({ ok: true, timezone: tz });
  } catch (err) {
    console.error("AGENCY_TIMEZONE_POST_ERROR", err);
    return Response.json({ ok: false, error: "SERVER_ERROR" }, { status: 500 });
  }
}