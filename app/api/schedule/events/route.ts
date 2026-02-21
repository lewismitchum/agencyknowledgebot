// app/api/schedule/events/route.ts
import type { NextRequest } from "next/server";
import { getDb, type Db } from "@/lib/db";
import { requireActiveMember } from "@/lib/authz";
import { requireFeature } from "@/lib/plans";
import { ensureSchema } from "@/lib/schema";

export const runtime = "nodejs";

type CreateEventBody = {
  bot_id?: string;
  title?: string;
  start_at?: string;
  end_at?: string | null;
  location?: string | null;
  notes?: string | null;
  document_id?: string | null;
  confidence?: number | null;
};

type DeleteEventBody = {
  id?: string;
};

function nowIso() {
  return new Date().toISOString();
}

function makeId(prefix: string) {
  const uuid =
    globalThis.crypto && "randomUUID" in globalThis.crypto
      ? (globalThis.crypto as any).randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}_${uuid}`;
}

function handleAuthzError(err: any) {
  const code = String(err?.code ?? err?.message ?? err);
  if (code === "UNAUTHENTICATED") return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (code === "FORBIDDEN_NOT_ACTIVE") return Response.json({ error: "Forbidden" }, { status: 403 });
  if (code === "FORBIDDEN_NOT_OWNER") return Response.json({ error: "Owner only" }, { status: 403 });
  return null;
}

function requireScheduleOr403(plan: unknown) {
  const gate = requireFeature(plan, "schedule");
  if (gate.ok) return null;
  return Response.json(gate.body, { status: gate.status });
}

async function assertBotAccess(db: Db, args: { bot_id: string; agency_id: string; user_id: string }) {
  const bot = (await db.get(
    `SELECT id
     FROM bots
     WHERE id = ? AND agency_id = ?
       AND (owner_user_id IS NULL OR owner_user_id = ?)
     LIMIT 1`,
    args.bot_id,
    args.agency_id,
    args.user_id
  )) as { id: string } | undefined;

  if (!bot?.id) throw new Error("BOT_NOT_FOUND");
}

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireActiveMember(req);

    const gated = requireScheduleOr403(ctx.plan);
    if (gated) return gated;

    const url = new URL(req.url);
    const bot_id = String(url.searchParams.get("bot_id") || "").trim();
    if (!bot_id) return Response.json({ error: "Missing bot_id" }, { status: 400 });

    const db: Db = await getDb();
    await ensureSchema(db);

    await assertBotAccess(db, { bot_id, agency_id: ctx.agencyId, user_id: ctx.userId });

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
    if (msg === "BOT_NOT_FOUND") return Response.json({ error: "Bot not found" }, { status: 404 });

    console.error("SCHEDULE_EVENTS_GET_ERROR", err);
    return Response.json({ error: "Server error", message: msg }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireActiveMember(req);

    const gated = requireScheduleOr403(ctx.plan);
    if (gated) return gated;

    const body = (await req.json().catch(() => null)) as CreateEventBody | null;

    const bot_id = String(body?.bot_id || "").trim();
    const title = String(body?.title || "").trim();
    const start_at = String(body?.start_at || "").trim();

    const end_at = body?.end_at == null ? null : String(body.end_at).trim() || null;
    const location = body?.location == null ? null : String(body.location).trim() || null;
    const notes = body?.notes == null ? null : String(body.notes);
    const document_id = body?.document_id == null ? null : String(body.document_id).trim() || null;

    const confidenceRaw = body?.confidence;
    const confidence =
      typeof confidenceRaw === "number" && Number.isFinite(confidenceRaw)
        ? Math.max(0, Math.min(1, confidenceRaw))
        : null;

    if (!bot_id) return Response.json({ error: "Missing bot_id" }, { status: 400 });
    if (!title) return Response.json({ error: "Missing title" }, { status: 400 });
    if (!start_at) return Response.json({ error: "Missing start_at" }, { status: 400 });

    const db: Db = await getDb();
    await ensureSchema(db);

    await assertBotAccess(db, { bot_id, agency_id: ctx.agencyId, user_id: ctx.userId });

    const id = makeId("evt");
    const created_at = nowIso();

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
      created_at
    );

    const created = await db.get(
      `SELECT id, title, start_at, end_at, location, notes, confidence, created_at
       FROM schedule_events
       WHERE id = ? AND agency_id = ? AND bot_id = ?
       LIMIT 1`,
      id,
      ctx.agencyId,
      bot_id
    );

    return Response.json({ ok: true, event: created ?? { id } });
  } catch (err: any) {
    const authResp = handleAuthzError(err);
    if (authResp) return authResp;

    const msg = String(err?.message ?? err);
    if (msg === "BOT_NOT_FOUND") return Response.json({ error: "Bot not found" }, { status: 404 });

    console.error("SCHEDULE_EVENTS_POST_ERROR", err);
    return Response.json({ error: "Server error", message: msg }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const ctx = await requireActiveMember(req);

    const gated = requireScheduleOr403(ctx.plan);
    if (gated) return gated;

    const body = (await req.json().catch(() => null)) as DeleteEventBody | null;
    const id = String(body?.id ?? "").trim();
    if (!id) return Response.json({ ok: false, error: "Missing id" }, { status: 400 });

    const db: Db = await getDb();
    await ensureSchema(db);

    // Load event to confirm agency + bot access
    const row = (await db.get(
      `SELECT id, bot_id
       FROM schedule_events
       WHERE id = ? AND agency_id = ?
       LIMIT 1`,
      id,
      ctx.agencyId
    )) as { id: string; bot_id: string } | undefined;

    if (!row?.id) return Response.json({ ok: false, error: "Not found" }, { status: 404 });

    await assertBotAccess(db, { bot_id: row.bot_id, agency_id: ctx.agencyId, user_id: ctx.userId });

    await db.run(`DELETE FROM schedule_events WHERE id = ? AND agency_id = ?`, id, ctx.agencyId);

    return Response.json({ ok: true });
  } catch (err: any) {
    const authResp = handleAuthzError(err);
    if (authResp) return authResp;

    const msg = String(err?.message ?? err);
    if (msg === "BOT_NOT_FOUND") return Response.json({ error: "Bot not found" }, { status: 404 });

    console.error("SCHEDULE_EVENTS_DELETE_ERROR", err);
    return Response.json({ error: "Server error", message: msg }, { status: 500 });
  }
}