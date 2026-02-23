import type { NextRequest } from "next/server";
import { getDb, type Db } from "@/lib/db";
import { requireActiveMember } from "@/lib/authz";
import { ensureSchema } from "@/lib/schema";

export const runtime = "nodejs";

function nowIso() {
  return new Date().toISOString();
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

function normNullish(v: any) {
  if (v === undefined) return undefined;
  if (v === null) return null;
  const s = String(v).trim();
  return s ? s : null;
}

export async function OPTIONS() {
  return new Response(null, { status: 204 });
}

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireActiveMember(req);
    const db = await getDb();
    await ensureSchema(db);

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
    console.error("SCHEDULE_EVENTS_GET_ERROR", err);
    return Response.json({ error: "Server error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireActiveMember(req);
    const db = await getDb();
    await ensureSchema(db);

    const body = (await req.json().catch(() => null)) as any;
    const title = String(body?.title ?? "").trim();
    const bot_id = String(body?.bot_id ?? "").trim();
    const start_at = String(body?.start_at ?? "").trim();
    const end_at = body?.end_at ?? null;
    const location = body?.location ?? null;
    const notes = body?.notes ?? null;

    if (!title || !start_at || !bot_id) return Response.json({ ok: false, error: "MISSING_FIELDS" }, { status: 400 });

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
    console.error("SCHEDULE_EVENTS_POST_ERROR", err);
    return Response.json({ error: "Server error" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const ctx = await requireActiveMember(req);
    const db = await getDb();
    await ensureSchema(db);

    const body = (await req.json().catch(() => null)) as any;
    const id = String(body?.id ?? "").trim();
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

    // Only update fields that are present in the request body.
    const title = body?.title !== undefined ? String(body.title ?? "").trim() : undefined;
    const start_at = body?.start_at !== undefined ? String(body.start_at ?? "").trim() : undefined;
    const end_at = body?.end_at !== undefined ? normNullish(body.end_at) : undefined;
    const location = body?.location !== undefined ? normNullish(body.location) : undefined;
    const notes = body?.notes !== undefined ? normNullish(body.notes) : undefined;

    const sets: string[] = [];
    const vals: any[] = [];

    if (title !== undefined) {
      if (!title) return Response.json({ ok: false, error: "TITLE_REQUIRED" }, { status: 400 });
      sets.push("title = ?");
      vals.push(title);
    }

    if (start_at !== undefined) {
      if (!start_at) return Response.json({ ok: false, error: "START_REQUIRED" }, { status: 400 });
      sets.push("start_at = ?");
      vals.push(start_at);
    }

    if (end_at !== undefined) {
      sets.push("end_at = ?");
      vals.push(end_at);
    }

    if (location !== undefined) {
      sets.push("location = ?");
      vals.push(location);
    }

    if (notes !== undefined) {
      sets.push("notes = ?");
      vals.push(notes);
    }

    if (!sets.length) return Response.json({ ok: false, error: "NO_FIELDS" }, { status: 400 });

    vals.push(id, ctx.agencyId);

    await db.run(
      `UPDATE schedule_events
       SET ${sets.join(", ")}
       WHERE id = ? AND agency_id = ?`,
      ...vals
    );

    return Response.json({ ok: true });
  } catch (err: any) {
    console.error("SCHEDULE_EVENTS_PATCH_ERROR", err);
    return Response.json({ error: "Server error" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const ctx = await requireActiveMember(req);
    const db = await getDb();
    await ensureSchema(db);

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
    console.error("SCHEDULE_EVENTS_DELETE_ERROR", err);
    return Response.json({ error: "Server error" }, { status: 500 });
  }
}