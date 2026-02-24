// app/api/schedule/prefs/route.ts
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

async function getAgencyTimezone(db: Db, agencyId: string) {
  const row = (await db.get(`SELECT timezone FROM agencies WHERE id = ? LIMIT 1`, agencyId)) as
    | { timezone?: string | null }
    | undefined;

  const tz = String(row?.timezone ?? "").trim();
  return tz || "America/Chicago";
}

function normalizeWeekStartsOn(v: any): "sun" | "mon" {
  return v === "sun" ? "sun" : "mon";
}

function normalizeDefaultView(v: any): "day" | "week" | "month" {
  return v === "day" || v === "month" ? v : "week";
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

    const agencyTz = await getAgencyTimezone(db, ctx.agencyId);

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
          week_starts_on: string | null;
          default_view: string | null;
          show_tasks: number | boolean | null;
          show_events: number | boolean | null;
          show_done_tasks: number | boolean | null;
        }
      | undefined;

    const prefs = row
      ? {
          timezone: (row.timezone ?? agencyTz) || "America/Chicago",
          week_starts_on: normalizeWeekStartsOn(row.week_starts_on),
          default_view: normalizeDefaultView(row.default_view),
          show_tasks: Boolean(row.show_tasks),
          show_events: Boolean(row.show_events),
          show_done_tasks: Boolean(row.show_done_tasks),
        }
      : {
          timezone: agencyTz,
          week_starts_on: "mon" as const,
          default_view: "week" as const,
          show_tasks: true,
          show_events: true,
          show_done_tasks: false,
        };

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
    const week_starts_on = normalizeWeekStartsOn(body?.week_starts_on);
    const default_view = normalizeDefaultView(body?.default_view);

    const show_tasks = Boolean(body?.show_tasks);
    const show_events = Boolean(body?.show_events);
    const show_done_tasks = Boolean(body?.show_done_tasks);

    const t = nowIso();

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
      t,
      t
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