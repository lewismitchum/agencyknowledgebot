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
  if (plan === "free") {
    const err: any = new Error("SCHEDULE_NOT_ENABLED");
    err.code = "SCHEDULE_NOT_ENABLED";
    throw err;
  }
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

    const row = (await db.get(
      `SELECT timezone, week_starts_on, default_view, show_tasks, show_events, show_done_tasks
       FROM schedule_prefs
       WHERE agency_id = ? AND user_id = ?
       LIMIT 1`,
      ctx.agencyId,
      ctx.userId
    )) as
      | {
          timezone: string | null;
          week_starts_on: "sun" | "mon";
          default_view: "day" | "week" | "month";
          show_tasks: number | boolean;
          show_events: number | boolean;
          show_done_tasks: number | boolean;
        }
      | undefined;

    const prefs = row
      ? {
          timezone: row.timezone ?? null,
          week_starts_on: (row.week_starts_on as any) || "mon",
          default_view: (row.default_view as any) || "week",
          show_tasks: Boolean(row.show_tasks),
          show_events: Boolean(row.show_events),
          show_done_tasks: Boolean(row.show_done_tasks),
        }
      : null;

    return Response.json({ ok: true, prefs });
  } catch (err: any) {
    if (err?.code === "SCHEDULE_NOT_ENABLED" || String(err?.message || "") === "SCHEDULE_NOT_ENABLED") {
      return Response.json(
        { ok: false, error: "SCHEDULE_NOT_ENABLED", message: "Schedule is a paid feature. Upgrade to enable it." },
        { status: 403 }
      );
    }

    console.error("SCHEDULE_PREFS_GET_ERROR", err);
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

    const timezone = body?.timezone ?? null;
    const week_starts_on = body?.week_starts_on === "sun" ? "sun" : "mon";
    const default_view = body?.default_view === "day" || body?.default_view === "month" ? body.default_view : "week";

    const show_tasks = Boolean(body?.show_tasks);
    const show_events = Boolean(body?.show_events);
    const show_done_tasks = Boolean(body?.show_done_tasks);

    // Upsert
    await db.run(
      `INSERT INTO schedule_prefs (
         agency_id, user_id,
         timezone, week_starts_on, default_view,
         show_tasks, show_events, show_done_tasks,
         created_at, updated_at
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(agency_id, user_id) DO UPDATE SET
         timezone = excluded.timezone,
         week_starts_on = excluded.week_starts_on,
         default_view = excluded.default_view,
         show_tasks = excluded.show_tasks,
         show_events = excluded.show_events,
         show_done_tasks = excluded.show_done_tasks,
         updated_at = excluded.updated_at`,
      ctx.agencyId,
      ctx.userId,
      timezone,
      week_starts_on,
      default_view,
      show_tasks ? 1 : 0,
      show_events ? 1 : 0,
      show_done_tasks ? 1 : 0,
      nowIso(),
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

    console.error("SCHEDULE_PREFS_POST_ERROR", err);
    return Response.json({ ok: false, error: "SERVER_ERROR" }, { status: 500 });
  }
}