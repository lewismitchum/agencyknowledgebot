// app/api/schedule/events/route.ts
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

export function normalizeToUtcIso(input: string, tz: string) {
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

export async function assertBotAccess(db: Db, args: { bot_id: string; agency_id: string; user_id: string }) {
  const bot = (await db.get(
    `SELECT id, agency_id, owner_user_id
     FROM bots
     WHERE id = ?
     LIMIT 1`,
    args.bot_id
  )) as { id: string; agency_id: string; owner_user_id: string | null } | undefined;

  if (!bot?.id) {
    const e: any = new Error("BOT_NOT_FOUND");
    e.code = "BOT_NOT_FOUND";
    throw e;
  }

  if (bot.agency_id !== args.agency_id) {
    const e: any = new Error("FORBIDDEN_BOT");
    e.code = "FORBIDDEN_BOT";
    throw e;
  }

  if (bot.owner_user_id && bot.owner_user_id !== args.user_id) {
    const e: any = new Error("FORBIDDEN_BOT");
    e.code = "FORBIDDEN_BOT";
    throw e;
  }
}

export async function createScheduleEvent(args: {
  db: Db;
  agencyId: string;
  userId: string;
  botId: string;
  title: string;
  startAt: string;
  endAt?: string | null;
  location?: string | null;
  notes?: string | null;
  timezone?: string | null;
}) {
  const title = String(args.title || "").trim();
  const startAtRaw = String(args.startAt || "").trim();

  if (!title || !startAtRaw) {
    const e: any = new Error("MISSING_FIELDS");
    e.code = "MISSING_FIELDS";
    throw e;
  }

  await assertBotAccess(args.db, {
    bot_id: args.botId,
    agency_id: args.agencyId,
    user_id: args.userId,
  });

  const tz = String(args.timezone || "").trim() || (await getAgencyTimezone(args.db, args.agencyId));

  const start_at = normalizeToUtcIso(startAtRaw, tz);
  if (!start_at || Number.isNaN(new Date(start_at).getTime())) {
    const e: any = new Error("BAD_START_AT");
    e.code = "BAD_START_AT";
    throw e;
  }

  let end_at: string | null = null;
  const endAtRaw = String(args.endAt || "").trim();
  if (endAtRaw) {
    const normalizedEnd = normalizeToUtcIso(endAtRaw, tz);
    if (!normalizedEnd || Number.isNaN(new Date(normalizedEnd).getTime())) {
      const e: any = new Error("BAD_END_AT");
      e.code = "BAD_END_AT";
      throw e;
    }
    end_at = normalizedEnd;
  }

  const idRow = (await args.db.get(`SELECT lower(hex(randomblob(16))) AS id`)) as { id: string } | undefined;
  const eventId = idRow?.id || "";

  await args.db.run(
    `INSERT INTO schedule_events (id, agency_id, bot_id, title, start_at, end_at, location, notes, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    eventId,
    args.agencyId,
    args.botId,
    title,
    start_at,
    end_at,
    args.location ?? null,
    args.notes ?? null,
    nowIso()
  );

  return {
    ok: true as const,
    id: eventId,
    title,
    start_at,
    end_at,
    location: args.location ?? null,
    notes: args.notes ?? null,
  };
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

    return Response.json({ ok: true, bot_id, timezone, events: events ?? [] });
  } catch (err: any) {
    const code = String(err?.code ?? err?.message ?? err);

    if (code === "UNAUTHENTICATED") {
      return Response.json({ ok: false, error: "UNAUTHENTICATED" }, { status: 401 });
    }
    if (code === "FORBIDDEN_NOT_ACTIVE") {
      return Response.json({ ok: false, error: "FORBIDDEN_NOT_ACTIVE" }, { status: 403 });
    }
    if (code === "BOT_NOT_FOUND") {
      return Response.json({ ok: false, error: "BOT_NOT_FOUND" }, { status: 404 });
    }
    if (code === "FORBIDDEN_BOT") {
      return Response.json({ ok: false, error: "FORBIDDEN_BOT" }, { status: 403 });
    }

    console.error("SCHEDULE_EVENTS_GET_ERROR", err);
    return Response.json({ ok: false, error: "SERVER_ERROR", message: String(err?.message ?? err) }, { status: 500 });
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
    const bot_id = String(body?.bot_id ?? "").trim();
    const start_at_raw = String(body?.start_at ?? "").trim();
    const end_at_raw = body?.end_at ?? null;
    const location = body?.location ?? null;
    const notes = body?.notes ?? null;

    if (!title || !bot_id || !start_at_raw) {
      return Response.json({ ok: false, error: "MISSING_FIELDS" }, { status: 400 });
    }

    const agencyTz = await getAgencyTimezone(db, ctx.agencyId);
    const userTz = getHeaderTz(req) || agencyTz;

    const created = await createScheduleEvent({
      db,
      agencyId: ctx.agencyId,
      userId: ctx.userId,
      botId: bot_id,
      title,
      startAt: start_at_raw,
      endAt: end_at_raw,
      location,
      notes,
      timezone: userTz,
    });

    return Response.json({ ok: true, event: created });
  } catch (err: any) {
    const code = String(err?.code ?? err?.message ?? err);

    if (code === "UNAUTHENTICATED") {
      return Response.json({ ok: false, error: "UNAUTHENTICATED" }, { status: 401 });
    }
    if (code === "FORBIDDEN_NOT_ACTIVE") {
      return Response.json({ ok: false, error: "FORBIDDEN_NOT_ACTIVE" }, { status: 403 });
    }
    if (code === "MISSING_FIELDS") {
      return Response.json({ ok: false, error: "MISSING_FIELDS" }, { status: 400 });
    }
    if (code === "BAD_START_AT") {
      return Response.json({ ok: false, error: "BAD_START_AT" }, { status: 400 });
    }
    if (code === "BAD_END_AT") {
      return Response.json({ ok: false, error: "BAD_END_AT" }, { status: 400 });
    }
    if (code === "BOT_NOT_FOUND") {
      return Response.json({ ok: false, error: "BOT_NOT_FOUND" }, { status: 404 });
    }
    if (code === "FORBIDDEN_BOT") {
      return Response.json({ ok: false, error: "FORBIDDEN_BOT" }, { status: 403 });
    }

    console.error("SCHEDULE_EVENTS_POST_ERROR", err);
    return Response.json({ ok: false, error: "SERVER_ERROR", message: String(err?.message ?? err) }, { status: 500 });
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
       FROM schedule_events
       WHERE id = ? AND agency_id = ?
       LIMIT 1`,
      id,
      ctx.agencyId
    )) as { id: string; bot_id: string } | undefined;

    if (!row?.id) return Response.json({ ok: false, error: "EVENT_NOT_FOUND" }, { status: 404 });

    await assertBotAccess(db, { bot_id: row.bot_id, agency_id: ctx.agencyId, user_id: ctx.userId });

    await db.run(`DELETE FROM schedule_events WHERE id = ? AND agency_id = ?`, id, ctx.agencyId);

    return Response.json({ ok: true });
  } catch (err: any) {
    const code = String(err?.code ?? err?.message ?? err);

    if (code === "UNAUTHENTICATED") {
      return Response.json({ ok: false, error: "UNAUTHENTICATED" }, { status: 401 });
    }
    if (code === "FORBIDDEN_NOT_ACTIVE") {
      return Response.json({ ok: false, error: "FORBIDDEN_NOT_ACTIVE" }, { status: 403 });
    }

    console.error("SCHEDULE_EVENTS_DELETE_ERROR", err);
    return Response.json({ ok: false, error: "SERVER_ERROR", message: String(err?.message ?? err) }, { status: 500 });
  }
}