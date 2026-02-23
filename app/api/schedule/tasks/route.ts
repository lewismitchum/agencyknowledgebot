import type { NextRequest } from "next/server";
import { getDb, type Db } from "@/lib/db";
import { requireActiveMember } from "@/lib/authz";
import { ensureSchema } from "@/lib/schema";

export const runtime = "nodejs";

function nowIso() {
  return new Date().toISOString();
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

    return Response.json({ ok: true, bot_id, tasks: tasks ?? [] });
  } catch (err: any) {
    console.error("SCHEDULE_TASKS_GET_ERROR", err);
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
    console.error("SCHEDULE_TASKS_POST_ERROR", err);
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
       FROM schedule_tasks
       WHERE id = ? AND agency_id = ?
       LIMIT 1`,
      id,
      ctx.agencyId
    )) as { id: string; bot_id: string } | undefined;

    if (!row?.id) return Response.json({ ok: false, error: "TASK_NOT_FOUND" }, { status: 404 });

    await assertBotAccess(db, { bot_id: row.bot_id, agency_id: ctx.agencyId, user_id: ctx.userId });

    // Only update fields that are present in the request body.
    const title = body?.title !== undefined ? String(body.title ?? "").trim() : undefined;
    const due_at = body?.due_at !== undefined ? normNullish(body.due_at) : undefined;
    const notes = body?.notes !== undefined ? normNullish(body.notes) : undefined;
    const status = body?.status !== undefined ? String(body.status ?? "").trim() : undefined;

    const sets: string[] = [];
    const vals: any[] = [];

    if (title !== undefined) {
      if (!title) return Response.json({ ok: false, error: "TITLE_REQUIRED" }, { status: 400 });
      sets.push("title = ?");
      vals.push(title);
    }

    if (due_at !== undefined) {
      sets.push("due_at = ?");
      vals.push(due_at);
    }

    if (notes !== undefined) {
      sets.push("notes = ?");
      vals.push(notes);
    }

    if (status !== undefined) {
      if (status !== "open" && status !== "done") return Response.json({ ok: false, error: "BAD_STATUS" }, { status: 400 });
      sets.push("status = ?");
      vals.push(status);
    }

    if (!sets.length) return Response.json({ ok: false, error: "NO_FIELDS" }, { status: 400 });

    vals.push(id, ctx.agencyId);

    await db.run(
      `UPDATE schedule_tasks
       SET ${sets.join(", ")}
       WHERE id = ? AND agency_id = ?`,
      ...vals
    );

    return Response.json({ ok: true });
  } catch (err: any) {
    console.error("SCHEDULE_TASKS_PATCH_ERROR", err);
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
    console.error("SCHEDULE_TASKS_DELETE_ERROR", err);
    return Response.json({ error: "Server error" }, { status: 500 });
  }
}