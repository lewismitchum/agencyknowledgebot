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

function isValidIanaTimeZone(tz: string) {
  const t = String(tz || "").trim();
  if (!t) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: t }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

function getHeaderTz(req: NextRequest) {
  const tz = String(req.headers.get("x-user-timezone") || "").trim();
  return isValidIanaTimeZone(tz) ? tz : "";
}

// Get offset minutes for an instant in a tz (UTC - local)
function tzOffsetMinutesAtInstant(date: Date, tz: string) {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  const parts = dtf.formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value || "00";

  const y = Number(get("year"));
  const mo = Number(get("month"));
  const da = Number(get("day"));
  const hh = Number(get("hour"));
  const mm = Number(get("minute"));
  const ss = Number(get("second"));

  const asIfUtc = Date.UTC(y, mo - 1, da, hh, mm, ss);
  const actualUtc = date.getTime();
  return Math.round((asIfUtc - actualUtc) / 60000);
}

// Convert a wall-clock local datetime in tz -> UTC ISO (2-pass for DST)
function zonedLocalToUtcIso(args: { y: number; mo: number; da: number; hh: number; mm: number; tz: string }) {
  const guessUtc = Date.UTC(args.y, args.mo - 1, args.da, args.hh, args.mm, 0, 0);

  let d = new Date(guessUtc);
  let off1 = tzOffsetMinutesAtInstant(d, args.tz);
  let utc1 = guessUtc - off1 * 60000;

  d = new Date(utc1);
  let off2 = tzOffsetMinutesAtInstant(d, args.tz);
  let utc2 = guessUtc - off2 * 60000;

  return new Date(utc2).toISOString();
}

function parseLocalDateTime(input: string) {
  const raw = String(input || "").trim();
  if (!raw) return null;

  // YYYY-MM-DD HH:mm
  let m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})$/.exec(raw);
  if (m) {
    return { y: Number(m[1]), mo: Number(m[2]), da: Number(m[3]), hh: Number(m[4]), mm: Number(m[5]) };
  }

  // YYYY-MM-DD h:mm(am|pm)
  m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})\s*(am|pm)$/i.exec(raw);
  if (m) {
    let hh = Number(m[4]);
    const ap = String(m[6]).toLowerCase();
    if (ap === "pm" && hh < 12) hh += 12;
    if (ap === "am" && hh === 12) hh = 0;
    return { y: Number(m[1]), mo: Number(m[2]), da: Number(m[3]), hh, mm: Number(m[5]) };
  }

  return null;
}

function looksIsoOrOffset(s: string) {
  const x = String(s || "").trim();
  if (!x) return false;
  if (x.includes("T") && (x.endsWith("Z") || /[+-]\d{2}:\d{2}$/.test(x))) return true;
  return false;
}

function normalizeToUtcIso(input: string, tz: string) {
  const raw = String(input || "").trim();
  if (!raw) return "";

  // ISO with TZ/offset -> Date handles it
  if (looksIsoOrOffset(raw) || raw.includes("T")) {
    const d = new Date(raw);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
    return raw;
  }

  // Local wall time -> use tz conversion
  const p = parseLocalDateTime(raw);
  if (p && isValidIanaTimeZone(tz)) {
    return zonedLocalToUtcIso({ ...p, tz });
  }

  // Last attempt
  const d = new Date(raw);
  if (!Number.isNaN(d.getTime())) return d.toISOString();
  return raw;
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

    const plan = await getAgencyPlan(db, ctx.agencyId, (ctx as any)?.plan);
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

    const plan = await getAgencyPlan(db, ctx.agencyId, (ctx as any)?.plan);
    const gated = requireScheduleOr403(plan);
    if (gated) return gated;

    const body = (await req.json().catch(() => null)) as any;
    const title = String(body?.title ?? "").trim();
    let bot_id = String(body?.bot_id ?? "").trim();
    const due_at_raw = body?.due_at ?? null;
    const notes = body?.notes ?? null;

    if (!title) return Response.json({ ok: false, error: "TITLE_REQUIRED" }, { status: 400 });

    if (!bot_id) {
      const fallback = await getFallbackBotId(db, ctx.agencyId, ctx.userId);
      if (!fallback) return Response.json({ ok: false, error: "NO_BOTS" }, { status: 404 });
      bot_id = fallback;
    }

    await assertBotAccess(db, { bot_id, agency_id: ctx.agencyId, user_id: ctx.userId });

    let due_at: string | null = null;

    if (due_at_raw != null && String(due_at_raw).trim()) {
      const agencyTz = await getAgencyTimezone(db, ctx.agencyId);
      const userTz = getHeaderTz(req) || agencyTz;

      const iso = normalizeToUtcIso(String(due_at_raw).trim(), userTz);
      if (!iso || Number.isNaN(new Date(iso).getTime())) {
        return Response.json({ ok: false, error: "BAD_DUE_AT" }, { status: 400 });
      }
      due_at = iso;
    }

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

    const plan = await getAgencyPlan(db, ctx.agencyId, (ctx as any)?.plan);
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

    const plan = await getAgencyPlan(db, ctx.agencyId, (ctx as any)?.plan);
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