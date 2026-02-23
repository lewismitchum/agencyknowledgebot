import type { NextRequest } from "next/server";
import { getDb, type Db } from "@/lib/db";
import { requireActiveMember } from "@/lib/authz";
import { ensureSchema } from "@/lib/schema";

export const runtime = "nodejs";

function nowIso() {
  return new Date().toISOString();
}

async function getAgencyPlan(db: Db, agencyId: string) {
  const row = (await db.get(
    `SELECT plan
     FROM agencies
     WHERE id = ?
     LIMIT 1`,
    agencyId
  )) as { plan?: string } | undefined;

  const plan = String(row?.plan || "free").toLowerCase().trim();
  return plan || "free";
}

function assertScheduleEnabled(plan: string) {
  // Paid-only: anything except "free"
  if (plan === "free") {
    const err: any = new Error("SCHEDULE_NOT_ENABLED");
    err.code = "SCHEDULE_NOT_ENABLED";
    throw err;
  }
}

async function assertBotAccess(db: Db, args: { bot_id: string; agency_id: string; user_id: string }) {
  const bot = (await db.get(
    `SELECT id, agency_id, owner_user_id
     FROM bots
     WHERE id = ?
     LIMIT 1`,
    args.bot_id
  )) as { id: string; agency_id: string; owner_user_id: string | null } | undefined;

  if (!bot?.id) throw new Error("BOT_NOT_FOUND");
  if (bot.agency_id !== args.agency_id) throw new Error("FORBIDDEN_BOT");
  if (bot.owner_user_id && bot.owner_user_id !== args.user_id) throw new Error("FORBIDDEN_BOT");
}

export async function OPTIONS() {
  return new Response(null, { status: 204 });
}

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireActiveMember(req);
    const db = await getDb();
    await ensureSchema(db);

    const plan = await getAgencyPlan(db, ctx.agencyId);
    assertScheduleEnabled(plan);

    const url = new URL(req.url);
    const bot_id = String(url.searchParams.get("bot_id") || "").trim();
    if (!bot_id) return Response.json({ ok: false, error: "BOT_REQUIRED" }, { status: 400 });

    await assertBotAccess(db, { bot_id, agency_id: ctx.agencyId, user_id: ctx.userId });

    const events = await db.all(
      `SELECT id, title, start_at, end_at, location, notes, created_at
       FROM schedule_events
       WHERE agency_id = ? AND bot_id = ?
       ORDER BY start_at ASC, created_at DESC`,
      ctx.agencyId,
      bot_id
    );

    return Response.json({ ok: true, bot_id, events: events ?? [] });
  } catch (err: any) {
    if (err?.code === "SCHEDULE_NOT_ENABLED" || String(err?.message || "") === "SCHEDULE_NOT_ENABLED") {
      return Response.json(
        { ok: false, error: "SCHEDULE_NOT_ENABLED", message: "Schedule is a paid feature. Upgrade to enable it." },
        { status: 403 }
      );
    }

    console.error("SCHEDULE_EVENTS_GET_ERROR", err);
    return Response.json({ ok: false, error: "SERVER_ERROR" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireActiveMember(req);
    const db = await getDb();
    await ensureSchema(db);

    const plan = await getAgencyPlan(db, ctx.agencyId);
    assertScheduleEnabled(plan);

    const body = (await req.json().catch(() => null)) as any;
    const title = String(body?.title ?? "").trim();
    const bot_id = String(body?.bot_id ?? "").trim();
    const start_at = String(body?.start_at ?? "").trim();
    const end_at = body?.end_at ?? null;
    const location = body?.location ?? null;
    const notes = body?.notes ?? null;

    if (!title || !start_at || !bot_id) {
      return Response.json({ ok: false, error: "MISSING_FIELDS" }, { status: 400 });
    }

    await assertBotAccess(db, { bot_id, agency_id: ctx.agencyId, user_id: ctx.userId });

    await db.run(
      `INSERT INTO schedule_events (id, agency_id, bot_id, title, start_at, end_at, location, notes, created_at)
       VALUES (lower(hex(randomblob(16))), ?, ?, ?, ?, ?, ?, ?, ?)`,
      ctx.agencyId,
      bot_id,
      title,
      start_at,
      end_at,
      location,
      notes,
      nowIso()
    );

    return Response.json({ ok: true });
  } catch (err: any) {
    if (err?.code === "SCHEDULE_NOT_ENABLED" || String(err?.message || "") === "SCHEDULE_NOT_ENABLED") {
      return Response.json(
        { ok: false, error: "SCHEDULE_NOT_ENABLED", message: "Schedule is a paid feature. Upgrade to enable it." },
        { status: 403 }
      );
    }

    console.error("SCHEDULE_EVENTS_POST_ERROR", err);
    return Response.json({ ok: false, error: "SERVER_ERROR" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const ctx = await requireActiveMember(req);
    const db = await getDb();
    await ensureSchema(db);

    const plan = await getAgencyPlan(db, ctx.agencyId);
    assertScheduleEnabled(plan);

    const url = new URL(req.url);
    let id = String(url.searchParams.get("id") || "").trim();

    if (!id) {
      const body = (await req.json().catch(() => null)) as any;
      id = String(body?.id ?? "").trim();
    }

    if (!id) return Response.json({ ok: false, error: "ID_REQUIRED" }, { status: 400 });

    const row = (await db.get(
      `SELECT id, bot_id
       FROM schedule_events
       WHERE id = ? AND agency_id = ?
       LIMIT 1`,
      id,
      ctx.agencyId
    )) as { id: string; bot_id: string } | undefined;

    if (!row?.id) return Response.json({ ok: false, error: "EVENT_NOT_FOUND" }, { status: 404 });

    await assertBotAccess(db, { bot_id: row.bot_id, agency_id: ctx.agencyId, user_id: ctx.userId });

    await db.run(
      `DELETE FROM schedule_events
       WHERE id = ? AND agency_id = ?`,
      id,
      ctx.agencyId
    );

    return Response.json({ ok: true });
  } catch (err: any) {
    if (err?.code === "SCHEDULE_NOT_ENABLED" || String(err?.message || "") === "SCHEDULE_NOT_ENABLED") {
      return Response.json(
        { ok: false, error: "SCHEDULE_NOT_ENABLED", message: "Schedule is a paid feature. Upgrade to enable it." },
        { status: 403 }
      );
    }

    console.error("SCHEDULE_EVENTS_DELETE_ERROR", err);
    return Response.json({ ok: false, error: "SERVER_ERROR" }, { status: 500 });
  }
}