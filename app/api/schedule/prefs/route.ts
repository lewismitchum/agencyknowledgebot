// app/api/schedule/prefs/route.ts
import type { NextRequest } from "next/server";
import { getDb, type Db } from "@/lib/db";
import { requireActiveMember } from "@/lib/authz";
import { normalizePlan, requireFeature } from "@/lib/plans";
import { ensureSchema } from "@/lib/schema";

export const runtime = "nodejs";

function nowIso() {
  return new Date().toISOString();
}

async function getAgencyPlan(db: Db, agencyId: string, fallback: unknown) {
  const row = (await db.get(
    `SELECT plan
     FROM agencies
     WHERE id = ?
     LIMIT 1`,
    agencyId
  )) as { plan?: string | null } | undefined;

  return normalizePlan(row?.plan ?? (fallback as any) ?? null);
}

function requireScheduleOr403(plan: unknown) {
  const gate = requireFeature(plan, "schedule");
  if (gate.ok) return null;
  return Response.json(gate.body, { status: gate.status });
}

function clampWeekStartsOn(v: any): "sun" | "mon" {
  const s = String(v || "").trim().toLowerCase();
  return s === "sun" ? "sun" : "mon";
}

function clampDefaultView(v: any): "day" | "week" | "month" {
  const s = String(v || "").trim().toLowerCase();
  if (s === "day" || s === "week" || s === "month") return s;
  return "week";
}

function toBoolInt(v: any, fallback: number) {
  if (v === true) return 1;
  if (v === false) return 0;
  if (v === 1 || v === "1" || String(v).toLowerCase() === "true") return 1;
  if (v === 0 || v === "0" || String(v).toLowerCase() === "false") return 0;
  return fallback;
}

async function ensureRow(db: Db, agencyId: string, userId: string) {
  const row = (await db.get(
    `SELECT agency_id
     FROM schedule_prefs
     WHERE agency_id = ? AND user_id = ?
     LIMIT 1`,
    agencyId,
    userId
  )) as { agency_id: string } | undefined;

  if (row?.agency_id) return;

  await db.run(
    `INSERT INTO schedule_prefs (
      agency_id, user_id,
      timezone, week_starts_on, default_view,
      show_tasks, show_events, show_done_tasks,
      created_at, updated_at
    ) VALUES (
      ?, ?,
      NULL, 'mon', 'week',
      1, 1, 0,
      ?, ?
    )`,
    agencyId,
    userId,
    nowIso(),
    nowIso()
  );
}

export async function OPTIONS() {
  return new Response(null, { status: 204 });
}

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireActiveMember(req);

    const db = await getDb();
    await ensureSchema(db);

    const plan = await getAgencyPlan(db, ctx.agencyId, (ctx as any)?.plan);
    const gated = requireScheduleOr403(plan);
    if (gated) return gated;

    await ensureRow(db, ctx.agencyId, ctx.userId);

    const row = (await db.get(
      `SELECT timezone, week_starts_on, default_view, show_tasks, show_events, show_done_tasks
       FROM schedule_prefs
       WHERE agency_id = ? AND user_id = ?
       LIMIT 1`,
      ctx.agencyId,
      ctx.userId
    )) as
      | {
          timezone?: string | null;
          week_starts_on?: string | null;
          default_view?: string | null;
          show_tasks?: number | null;
          show_events?: number | null;
          show_done_tasks?: number | null;
        }
      | undefined;

    const prefs = {
      timezone: row?.timezone ?? null,
      week_starts_on: clampWeekStartsOn(row?.week_starts_on),
      default_view: clampDefaultView(row?.default_view),
      show_tasks: !!(row?.show_tasks ?? 1),
      show_events: !!(row?.show_events ?? 1),
      show_done_tasks: !!(row?.show_done_tasks ?? 0),
    };

    return Response.json({ ok: true, prefs });
  } catch (err: any) {
    const code = String(err?.code ?? err?.message ?? err);

    if (code === "UNAUTHENTICATED") {
      return Response.json({ ok: false, error: "UNAUTHENTICATED" }, { status: 401 });
    }
    if (code === "FORBIDDEN_NOT_ACTIVE") {
      return Response.json({ ok: false, error: "FORBIDDEN_NOT_ACTIVE" }, { status: 403 });
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

    const plan = await getAgencyPlan(db, ctx.agencyId, (ctx as any)?.plan);
    const gated = requireScheduleOr403(plan);
    if (gated) return gated;

    const body = (await req.json().catch(() => null)) as any;

    const timezone = body?.timezone == null ? null : String(body.timezone).trim() || null;
    const week_starts_on = clampWeekStartsOn(body?.week_starts_on);
    const default_view = clampDefaultView(body?.default_view);

    // If fields are missing, keep existing defaults using fallback ints
    await ensureRow(db, ctx.agencyId, ctx.userId);

    const current = (await db.get(
      `SELECT show_tasks, show_events, show_done_tasks
       FROM schedule_prefs
       WHERE agency_id = ? AND user_id = ?
       LIMIT 1`,
      ctx.agencyId,
      ctx.userId
    )) as { show_tasks?: number | null; show_events?: number | null; show_done_tasks?: number | null } | undefined;

    const show_tasks = toBoolInt(body?.show_tasks, current?.show_tasks ?? 1);
    const show_events = toBoolInt(body?.show_events, current?.show_events ?? 1);
    const show_done_tasks = toBoolInt(body?.show_done_tasks, current?.show_done_tasks ?? 0);

    await db.run(
      `INSERT INTO schedule_prefs (
        agency_id, user_id,
        timezone, week_starts_on, default_view,
        show_tasks, show_events, show_done_tasks,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      show_tasks,
      show_events,
      show_done_tasks,
      nowIso(),
      nowIso()
    );

    return Response.json({ ok: true });
  } catch (err: any) {
    const code = String(err?.code ?? err?.message ?? err);

    if (code === "UNAUTHENTICATED") {
      return Response.json({ ok: false, error: "UNAUTHENTICATED" }, { status: 401 });
    }
    if (code === "FORBIDDEN_NOT_ACTIVE") {
      return Response.json({ ok: false, error: "FORBIDDEN_NOT_ACTIVE" }, { status: 403 });
    }

    console.error("SCHEDULE_PREFS_POST_ERROR", err);
    return Response.json({ ok: false, error: "SERVER_ERROR" }, { status: 500 });
  }
}