// app/api/schedule/tasks/route.ts
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

async function getAgencyTimezone(db: Db, agencyId: string) {
  const row = (await db.get(`SELECT timezone FROM agencies WHERE id = ? LIMIT 1`, agencyId)) as
    | { timezone?: string | null }
    | undefined;

  const tz = String(row?.timezone ?? "").trim();
  return tz || "America/Chicago";
}

async function getFallbackBotId(db: Db, agencyId: string, userId: string) {
  const agencyBot = (await db.get(
    `SELECT id
     FROM bots
     WHERE agency_id = ? AND owner_user_id IS NULL
     ORDER BY created_at DESC
     LIMIT 1`,
    agencyId
  )) as { id: string } | undefined;

  if (agencyBot?.id) return agencyBot.id;

  const userBot = (await db.get(
    `SELECT id
     FROM bots
     WHERE agency_id = ? AND owner_user_id = ?
     ORDER BY created_at DESC
     LIMIT 1`,
    agencyId,
    userId
  )) as { id: string } | undefined;

  return userBot?.id ?? null;
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

    const plan = await getAgencyPlan(db, ctx.agencyId, ctx.plan);
    const gated = requireScheduleOr403(plan);
    if (gated) return gated;

    const timezone = await getAgencyTimezone(db, ctx.agencyId);

    const url = new URL(req.url);
    let bot_id = String(url.searchParams.get("bot_id") || "").trim();

    if (!bot_id) {
      const fallback = await getFallbackBotId(db, ctx.agencyId, ctx.userId);
      if (!fallback) return Response.json({ ok: false, error: "NO_BOTS" }, { status: 404 });
      bot_id = fallback;
    }

    await assertBotAccess(db, { bot_id, agency_id: ctx.agencyId, user_id: ctx.userId });

    const tasks = await db.all(
      `SELECT id, title, due_at, status, notes, created_at
       FROM schedule_tasks
       WHERE agency_id = ? AND bot_id = ?
       ORDER BY
         CASE WHEN due_at IS NULL THEN 1 ELSE 0 END,
         due_at ASC,
         created_at DESC`,
      ctx.agencyId,
      bot_id
    );

    return Response.json({ ok: true, bot_id, timezone, tasks: tasks ?? [] });
  } catch (err: any) {
    const msg = String(err?.code ?? err?.message ?? err);
    if (msg === "UNAUTHENTICATED") return Response.json({ ok: false, error: "UNAUTHENTICATED" }, { status: 401 });
    if (msg === "FORBIDDEN_NOT_ACTIVE") return Response.json({ ok: false, error: "FORBIDDEN_NOT_ACTIVE" }, { status: 403 });

    console.error("SCHEDULE_TASKS_GET_ERROR", err);
    return Response.json({ ok: false, error: "SERVER_ERROR" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireActiveMember(req);
    const db = await getDb();
    await ensureSchema(db);

    const plan = await getAgencyPlan(db, ctx.agencyId, ctx.plan);
    const gated = requireScheduleOr403(plan);
    if (gated) return gated;

    const body = (await req.json().catch(() => null)) as any;
    const title = String(body?.title ?? "").trim();
    let bot_id = String(body?.bot_id ?? "").trim();
    const due_at = body?.due_at ?? null;
    const notes = body?.notes ?? null;

    if (!title) return Response.json({ ok: false, error: "TITLE_REQUIRED" }, { status: 400 });

    if (!bot_id) {
      const fallback = await getFallbackBotId(db, ctx.agencyId, ctx.userId);
      if (!fallback) return Response.json({ ok: false, error: "NO_BOTS" }, { status: 404 });
      bot_id = fallback;
    }

    await assertBotAccess(db, { bot_id, agency_id: ctx.agencyId, user_id: ctx.userId });

    await db.run(
      `INSERT INTO schedule_tasks (id, agency_id, bot_id, title, due_at, status, notes, created_at)
       VALUES (lower(hex(randomblob(16))), ?, ?, ?, ?, 'open', ?, ?)`,
      ctx.agencyId,
      bot_id,
      title,
      due_at,
      notes,
      nowIso()
    );

    return Response.json({ ok: true });
  } catch (err: any) {
    const msg = String(err?.code ?? err?.message ?? err);
    if (msg === "UNAUTHENTICATED") return Response.json({ ok: false, error: "UNAUTHENTICATED" }, { status: 401 });
    if (msg === "FORBIDDEN_NOT_ACTIVE") return Response.json({ ok: false, error: "FORBIDDEN_NOT_ACTIVE" }, { status: 403 });

    console.error("SCHEDULE_TASKS_POST_ERROR", err);
    return Response.json({ ok: false, error: "SERVER_ERROR" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const ctx = await requireActiveMember(req);
    const db = await getDb();
    await ensureSchema(db);

    const plan = await getAgencyPlan(db, ctx.agencyId, ctx.plan);
    const gated = requireScheduleOr403(plan);
    if (gated) return gated;

    const body = (await req.json().catch(() => null)) as any;
    const id = String(body?.id ?? "").trim();
    const status = String(body?.status ?? "").trim();

    if (!id) return Response.json({ ok: false, error: "ID_REQUIRED" }, { status: 400 });
    if (status !== "open" && status !== "done") {
      return Response.json({ ok: false, error: "BAD_STATUS" }, { status: 400 });
    }

    const row = (await db.get(
      `SELECT id, bot_id
       FROM schedule_tasks
       WHERE id = ? AND agency_id = ?
       LIMIT 1`,
      id,
      ctx.agencyId
    )) as { id: string; bot_id: string } | undefined;

    if (!row?.id) return Response.json({ ok: false, error: "TASK_NOT_FOUND" }, { status: 404 });

    await assertBotAccess(db, { bot_id: row.bot_id, agency_id: ctx.agencyId, user_id: ctx.userId });

    await db.run(
      `UPDATE schedule_tasks
       SET status = ?
       WHERE id = ? AND agency_id = ?`,
      status,
      id,
      ctx.agencyId
    );

    return Response.json({ ok: true });
  } catch (err: any) {
    const msg = String(err?.code ?? err?.message ?? err);
    if (msg === "UNAUTHENTICATED") return Response.json({ ok: false, error: "UNAUTHENTICATED" }, { status: 401 });
    if (msg === "FORBIDDEN_NOT_ACTIVE") return Response.json({ ok: false, error: "FORBIDDEN_NOT_ACTIVE" }, { status: 403 });

    console.error("SCHEDULE_TASKS_PATCH_ERROR", err);
    return Response.json({ ok: false, error: "SERVER_ERROR" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const ctx = await requireActiveMember(req);
    const db = await getDb();
    await ensureSchema(db);

    const plan = await getAgencyPlan(db, ctx.agencyId, ctx.plan);
    const gated = requireScheduleOr403(plan);
    if (gated) return gated;

    const url = new URL(req.url);
    let id = String(url.searchParams.get("id") || "").trim();

    if (!id) {
      const body = (await req.json().catch(() => null)) as any;
      id = String(body?.id ?? "").trim();
    }

    if (!id) return Response.json({ ok: false, error: "ID_REQUIRED" }, { status: 400 });

    const row = (await db.get(
      `SELECT id, bot_id
       FROM schedule_tasks
       WHERE id = ? AND agency_id = ?
       LIMIT 1`,
      id,
      ctx.agencyId
    )) as { id: string; bot_id: string } | undefined;

    if (!row?.id) return Response.json({ ok: false, error: "TASK_NOT_FOUND" }, { status: 404 });

    await assertBotAccess(db, { bot_id: row.bot_id, agency_id: ctx.agencyId, user_id: ctx.userId });

    await db.run(
      `DELETE FROM schedule_tasks
       WHERE id = ? AND agency_id = ?`,
      id,
      ctx.agencyId
    );

    return Response.json({ ok: true });
  } catch (err: any) {
    const msg = String(err?.code ?? err?.message ?? err);
    if (msg === "UNAUTHENTICATED") return Response.json({ ok: false, error: "UNAUTHENTICATED" }, { status: 401 });
    if (msg === "FORBIDDEN_NOT_ACTIVE") return Response.json({ ok: false, error: "FORBIDDEN_NOT_ACTIVE" }, { status: 403 });

    console.error("SCHEDULE_TASKS_DELETE_ERROR", err);
    return Response.json({ ok: false, error: "SERVER_ERROR" }, { status: 500 });
  }
}