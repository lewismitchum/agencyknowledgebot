import type { NextRequest } from "next/server";
import { getDb, type Db } from "@/lib/db";
import { requireActiveMember } from "@/lib/authz";
import { ensureScheduleTables } from "@/lib/db/migrations";
import { requireFeature } from "@/lib/plans";

export const runtime = "nodejs";

function makeId(prefix: string) {
  const uuid =
    globalThis.crypto &&
    "randomUUID" in globalThis.crypto &&
    (globalThis.crypto as any).randomUUID
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
  return Response.json(gate.body, { status: gate.status }); // 403
}

export async function GET(req: NextRequest) {
  try {
    await ensureScheduleTables();

    const ctx = await requireActiveMember(req);

    // ✅ Paid feature gate (canonical)
    const gated = requireScheduleOr403(ctx.plan);
    if (gated) return gated;

    const url = new URL(req.url);
    const bot_id = String(url.searchParams.get("bot_id") || "").trim();
    if (!bot_id) return Response.json({ error: "Missing bot_id" }, { status: 400 });

    const db: Db = await getDb();

    await assertBotAccess(db, { bot_id, agency_id: ctx.agencyId, user_id: ctx.userId });

    const events = await db.all(
      `SELECT id, title, starts_at, ends_at, location, notes, created_at
       FROM schedule_events
       WHERE agency_id = ? AND user_id = ? AND bot_id = ?
       ORDER BY starts_at ASC`,
      ctx.agencyId,
      ctx.userId,
      bot_id
    );

    return Response.json({ ok: true, events: events ?? [] });
  } catch (err: any) {
    const authResp = handleAuthzError(err);
    if (authResp) return authResp;

    const msg = String(err?.message ?? err);
    if (msg === "BOT_NOT_FOUND") return Response.json({ error: "Bot not found" }, { status: 404 });
    if (msg === "BOT_FORBIDDEN") return Response.json({ error: "Forbidden" }, { status: 403 });

    console.error("SCHEDULE_EVENTS_GET_ERROR", err);
    return Response.json({ error: "Server error", message: msg }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    await ensureScheduleTables();

    const ctx = await requireActiveMember(req);

    // ✅ Paid feature gate (canonical)
    const gated = requireScheduleOr403(ctx.plan);
    if (gated) return gated;

    const body = await req.json().catch(() => null);

    const bot_id = String(body?.bot_id || "").trim();
    const title = String(body?.title || "").trim();
    const starts_at = String(body?.starts_at || "").trim();

    const ends_at = body?.ends_at ? String(body.ends_at).trim() : null;
    const location = body?.location ? String(body.location).trim() : null;
    const notes = body?.notes ? String(body.notes) : null;
    const source_document_id = body?.source_document_id ? String(body.source_document_id) : null;

    if (!bot_id) return Response.json({ error: "Missing bot_id" }, { status: 400 });
    if (!title) return Response.json({ error: "Missing title" }, { status: 400 });
    if (!starts_at) return Response.json({ error: "Missing starts_at" }, { status: 400 });

    const db: Db = await getDb();

    await assertBotAccess(db, { bot_id, agency_id: ctx.agencyId, user_id: ctx.userId });

    const id = makeId("evt");
    const now = new Date().toISOString();

    await db.run(
      `INSERT INTO schedule_events
       (id, agency_id, user_id, bot_id, source_document_id, title, starts_at, ends_at, location, notes, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      ctx.agencyId,
      ctx.userId,
      bot_id,
      source_document_id,
      title,
      starts_at,
      ends_at,
      location,
      notes,
      now
    );

    return Response.json({ ok: true, id });
  } catch (err: any) {
    const authResp = handleAuthzError(err);
    if (authResp) return authResp;

    const msg = String(err?.message ?? err);
    if (msg === "BOT_NOT_FOUND") return Response.json({ error: "Bot not found" }, { status: 404 });
    if (msg === "BOT_FORBIDDEN") return Response.json({ error: "Forbidden" }, { status: 403 });

    console.error("SCHEDULE_EVENTS_POST_ERROR", err);
    return Response.json({ error: "Server error", message: msg }, { status: 500 });
  }
}
