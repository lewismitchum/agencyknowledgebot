import type { NextRequest } from "next/server";
import { getDb, type Db } from "@/lib/db";
import { requireActiveMember } from "@/lib/authz";
import { ensureSchedulePrefTables } from "@/lib/db/ensure-schedule-prefs";
import { requireFeature } from "@/lib/plans";

export const runtime = "nodejs";

type Prefs = {
  timezone?: string | null;
  week_starts_on?: "sun" | "mon";
  default_view?: "day" | "week" | "month";
  show_tasks?: boolean;
  show_events?: boolean;
  show_done_tasks?: boolean;
};

function nowIso() {
  return new Date().toISOString();
}

function requireScheduleOr403(plan: unknown) {
  const gate = requireFeature(plan, "schedule");
  if (gate.ok) return null;
  return Response.json(gate.body, { status: gate.status }); // 403
}

export async function GET(req: NextRequest) {
  try {
    await ensureSchedulePrefTables();

    const ctx = await requireActiveMember(req);

    // ✅ Paid-only gate (prefs are part of schedule feature set)
    const gated = requireScheduleOr403(ctx.plan);
    if (gated) return gated;

    const db: Db = await getDb();

    const row = (await db.get(
      `SELECT timezone, week_starts_on, default_view,
              show_tasks, show_events, show_done_tasks
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
          show_tasks: number | null;
          show_events: number | null;
          show_done_tasks: number | null;
        }
      | undefined;

    if (!row) return Response.json({ ok: true, prefs: null });

    return Response.json({
      ok: true,
      prefs: {
        timezone: row.timezone ?? null,
        week_starts_on: (row.week_starts_on || "mon") as "sun" | "mon",
        default_view: (row.default_view || "week") as "day" | "week" | "month",
        show_tasks: !!row.show_tasks,
        show_events: !!row.show_events,
        show_done_tasks: !!row.show_done_tasks,
      },
    });
  } catch (err: any) {
    const msg = String(err?.code ?? err?.message ?? err);
    if (msg === "UNAUTHENTICATED")
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    if (msg === "FORBIDDEN_NOT_ACTIVE")
      return Response.json({ error: "Pending approval" }, { status: 403 });
    return Response.json({ error: "Server error", message: msg }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    await ensureSchedulePrefTables();

    const ctx = await requireActiveMember(req);

    // ✅ Paid-only gate
    const gated = requireScheduleOr403(ctx.plan);
    if (gated) return gated;

    const db: Db = await getDb();

    const body = (await req.json().catch(() => ({}))) as Prefs;

    const timezone = body.timezone ? String(body.timezone) : null;

    const week_starts_on =
      body.week_starts_on === "sun" || body.week_starts_on === "mon"
        ? body.week_starts_on
        : "mon";

    const default_view =
      body.default_view === "day" ||
      body.default_view === "week" ||
      body.default_view === "month"
        ? body.default_view
        : "week";

    const show_tasks = body.show_tasks === false ? 0 : 1;
    const show_events = body.show_events === false ? 0 : 1;
    const show_done_tasks = body.show_done_tasks === true ? 1 : 0;

    const existing = (await db.get(
      `SELECT id FROM schedule_prefs WHERE agency_id = ? AND user_id = ? LIMIT 1`,
      ctx.agencyId,
      ctx.userId
    )) as { id: string } | undefined;

    const ts = nowIso();

    if (!existing?.id) {
      const id = `pref_${ctx.userId}`;
      await db.run(
        `INSERT INTO schedule_prefs
          (id, agency_id, user_id, timezone, week_starts_on, default_view, show_tasks, show_events, show_done_tasks, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        id,
        ctx.agencyId,
        ctx.userId,
        timezone,
        week_starts_on,
        default_view,
        show_tasks,
        show_events,
        show_done_tasks,
        ts,
        ts
      );
    } else {
      await db.run(
        `UPDATE schedule_prefs
         SET timezone = ?, week_starts_on = ?, default_view = ?,
             show_tasks = ?, show_events = ?, show_done_tasks = ?,
             updated_at = ?
         WHERE agency_id = ? AND user_id = ?`,
        timezone,
        week_starts_on,
        default_view,
        show_tasks,
        show_events,
        show_done_tasks,
        ts,
        ctx.agencyId,
        ctx.userId
      );
    }

    return Response.json({ ok: true });
  } catch (err: any) {
    const msg = String(err?.code ?? err?.message ?? err);
    if (msg === "UNAUTHENTICATED")
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    if (msg === "FORBIDDEN_NOT_ACTIVE")
      return Response.json({ error: "Pending approval" }, { status: 403 });
    return Response.json({ error: "Server error", message: msg }, { status: 500 });
  }
}
