// app/api/schedule/events/route.ts
import type { NextRequest } from "next/server";
import { getDb, type Db } from "@/lib/db";
import { requireActiveMember } from "@/lib/authz";
import { requireFeature } from "@/lib/plans";
import { ensureSchema } from "@/lib/schema";

export const runtime = "nodejs";

function makeId(prefix: string) {
  const uuid =
    globalThis.crypto && "randomUUID" in globalThis.crypto
      ? (globalThis.crypto as any).randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}_${uuid}`;
}

async function assertBotAccess(
  db: Db,
  args: { bot_id: string; agency_id: string; user_id: string }
) {
  const bot = (await db.get(
    `SELECT id, agency_id, owner_user_id
     FROM bots
     WHERE id = ?
     LIMIT 1`,
    args.bot_id
  )) as { id: string; agency_id: string; owner_user_id: string | null } | undefined;

  if (!bot?.id) throw new Error("BOT_NOT_FOUND");
  if (bot.agency_id !== args.agency_id) throw new Error("BOT_FORBIDDEN");
  if (bot.owner_user_id && bot.owner_user_id !== args.user_id)
    throw new Error("BOT_FORBIDDEN");
}

function handleAuthzError(err: any) {
  const code = String(err?.code ?? err?.message ?? err);
  if (code === "UNAUTHENTICATED")
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (code === "FORBIDDEN_NOT_ACTIVE")
    return Response.json({ error: "Forbidden" }, { status: 403 });
  if (code === "FORBIDDEN_NOT_OWNER")
    return Response.json({ error: "Owner only" }, { status: 403 });
  return null;
}

function requireScheduleOr403(plan: unknown) {
  const gate = requireFeature(plan, "schedule");
  if (gate.ok) return null;
  return Response.json(gate.body, { status: gate.status });
}

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireActiveMember(req);

    const gated = requireScheduleOr403(ctx.plan);
    if (gated) return gated;

    const db: Db = await getDb();
    await ensureSchema(db);

    const url = new URL(req.url);
    const bot_id = String(url.searchParams.get("bot_id") || "").trim();
    if (!bot_id)
      return Response.json({ error: "Missing bot_id" }, { status: 400 });

    await assertBotAccess(db, {
      bot_id,
      agency_id: ctx.agencyId,
      user_id: ctx.userId,
    });

    const events = await db.all(
      `SELECT id, title, start_at, end_at, location, notes, confidence, created_at
       FROM schedule_events
       WHERE agency_id = ? AND bot_id = ?
       ORDER BY start_at ASC`,
      ctx.agencyId,
      bot_id
    );

    return Response.json({ ok: true, events: events ?? [] });
  } catch (err: any) {
    const authResp = handleAuthzError(err);
    if (authResp) return authResp;

    const msg = String(err?.message ?? err);
    if (msg === "BOT_NOT_FOUND")
      return Response.json({ error: "Bot not found" }, { status: 404 });
    if (msg === "BOT_FORBIDDEN")
      return Response.json({ error: "Forbidden" }, { status: 403 });

    console.error("SCHEDULE_EVENTS_GET_ERROR", err);
    return Response.json(
      { error: "Server error", message: msg },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireActiveMember(req);

    const gated = requireScheduleOr403(ctx.plan);
    if (gated) return gated;

    const db: Db = await getDb();
    await ensureSchema(db);

    const body = await req.json().catch(() => null);

    const bot_id = String(body?.bot_id || "").trim();
    const title = String(body?.title || "").trim();
    const start_at = String(body?.start_at || "").trim();

    const end_at = body?.end_at ? String(body.end_at).trim() : null;
    const location = body?.location ? String(body.location).trim() : null;
    const notes = body?.notes ? String(body.notes) : null;
    const document_id = body?.document_id
      ? String(body.document_id)
      : null;
    const confidence =
      typeof body?.confidence === "number" ? body.confidence : null;

    if (!bot_id)
      return Response.json({ error: "Missing bot_id" }, { status: 400 });
    if (!title)
      return Response.json({ error: "Missing title" }, { status: 400 });
    if (!start_at)
      return Response.json({ error: "Missing start_at" }, { status: 400 });

    await assertBotAccess(db, {
      bot_id,
      agency_id: ctx.agencyId,
      user_id: ctx.userId,
    });

    const id = makeId("evt");
    const now = new Date().toISOString();

    await db.run(
      `INSERT INTO schedule_events
       (id, agency_id, bot_id, document_id, title, start_at, end_at, location, notes, confidence, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      ctx.agencyId,
      bot_id,
      document_id,
      title,
      start_at,
      end_at,
      location,
      notes,
      confidence,
      now
    );

    return Response.json({ ok: true, id });
  } catch (err: any) {
    const authResp = handleAuthzError(err);
    if (authResp) return authResp;

    const msg = String(err?.message ?? err);
    if (msg === "BOT_NOT_FOUND")
      return Response.json({ error: "Bot not found" }, { status: 404 });
    if (msg === "BOT_FORBIDDEN")
      return Response.json({ error: "Forbidden" }, { status: 403 });

    console.error("SCHEDULE_EVENTS_POST_ERROR", err);
    return Response.json(
      { error: "Server error", message: msg },
      { status: 500 }
    );
  }
}
