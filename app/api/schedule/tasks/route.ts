// app/api/schedule/tasks/route.ts
import type { NextRequest } from "next/server";
import { getDb, type Db } from "@/lib/db";
import { requireActiveMember } from "@/lib/authz";
import { requireFeature } from "@/lib/plans";
import { ensureSchema } from "@/lib/schema";

export const runtime = "nodejs";

type CreateTaskBody = {
  bot_id?: string;
  title?: string;
  due_at?: string | null;
};

type UpdateTaskBody = {
  id?: string;
  status?: "open" | "done";
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
    const botId = String(url.searchParams.get("bot_id") || "").trim();
    if (!botId) {
      return Response.json({ ok: false, error: "Missing bot_id" }, { status: 400 });
    }

    const db: Db = await getDb();
    await ensureSchema(db);

    await assertBotAccess(db, { bot_id: botId, agency_id: ctx.agencyId, user_id: ctx.userId });

    const tasks = await db.all(
      `SELECT id, title, status, due_at, created_at
       FROM schedule_tasks
       WHERE agency_id = ? AND bot_id = ?
       ORDER BY
         CASE WHEN due_at IS NULL THEN 1 ELSE 0 END,
         due_at ASC,
         created_at DESC`,
      ctx.agencyId,
      botId
    );

    return Response.json({ ok: true, tasks: tasks ?? [] });
  } catch (err: any) {
    const code = String(err?.code ?? err?.message ?? err);
    if (code === "UNAUTHENTICATED") return Response.json({ error: "Unauthorized" }, { status: 401 });
    if (code === "FORBIDDEN_NOT_ACTIVE") return Response.json({ error: "Forbidden" }, { status: 403 });

    const msg = String(err?.message ?? err);
    if (msg === "BOT_NOT_FOUND") return Response.json({ ok: false, error: "Bot not found" }, { status: 404 });

    console.error("SCHEDULE_TASKS_GET_ERROR", err);
    return Response.json({ error: "Server error", message: msg }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireActiveMember(req);

    const gated = requireScheduleOr403(ctx.plan);
    if (gated) return gated;

    const body = (await req.json().catch(() => null)) as CreateTaskBody | null;
    const botId = String(body?.bot_id ?? "").trim();
    const title = String(body?.title ?? "").trim();
    const due_at = body?.due_at == null ? null : String(body.due_at).trim() || null;

    if (!botId) return Response.json({ ok: false, error: "Missing bot_id" }, { status: 400 });
    if (!title) return Response.json({ ok: false, error: "Missing title" }, { status: 400 });

    const db: Db = await getDb();
    await ensureSchema(db);

    await assertBotAccess(db, { bot_id: botId, agency_id: ctx.agencyId, user_id: ctx.userId });

    const id = makeId("tsk");
    const created_at = nowIso();

    await db.run(
      `INSERT INTO schedule_tasks
       (id, agency_id, bot_id, document_id, title, due_at, status, notes, confidence, created_at)
       VALUES (?, ?, ?, NULL, ?, ?, 'open', NULL, NULL, ?)`,
      id,
      ctx.agencyId,
      botId,
      title,
      due_at,
      created_at
    );

    const created = await db.get(
      `SELECT id, title, status, due_at, created_at
       FROM schedule_tasks
       WHERE id = ? AND agency_id = ? AND bot_id = ?
       LIMIT 1`,
      id,
      ctx.agencyId,
      botId
    );

    return Response.json({ ok: true, task: created ?? null });
  } catch (err: any) {
    const code = String(err?.code ?? err?.message ?? err);
    if (code === "UNAUTHENTICATED") return Response.json({ error: "Unauthorized" }, { status: 401 });
    if (code === "FORBIDDEN_NOT_ACTIVE") return Response.json({ error: "Forbidden" }, { status: 403 });

    const msg = String(err?.message ?? err);
    if (msg === "BOT_NOT_FOUND") return Response.json({ ok: false, error: "Bot not found" }, { status: 404 });

    console.error("SCHEDULE_TASKS_POST_ERROR", err);
    return Response.json({ error: "Server error", message: msg }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const ctx = await requireActiveMember(req);

    const gated = requireScheduleOr403(ctx.plan);
    if (gated) return gated;

    const body = (await req.json().catch(() => null)) as UpdateTaskBody | null;
    const id = String(body?.id ?? "").trim();
    const status = body?.status === "done" ? "done" : body?.status === "open" ? "open" : null;

    if (!id) return Response.json({ ok: false, error: "Missing id" }, { status: 400 });
    if (!status) return Response.json({ ok: false, error: "Missing status" }, { status: 400 });

    const db: Db = await getDb();
    await ensureSchema(db);

    // Load to verify agency + bot access
    const row = (await db.get(
      `SELECT id, bot_id
       FROM schedule_tasks
       WHERE id = ? AND agency_id = ?
       LIMIT 1`,
      id,
      ctx.agencyId
    )) as { id: string; bot_id: string } | undefined;

    if (!row?.id) return Response.json({ ok: false, error: "Not found" }, { status: 404 });

    await assertBotAccess(db, { bot_id: row.bot_id, agency_id: ctx.agencyId, user_id: ctx.userId });

    await db.run(
      `UPDATE schedule_tasks
       SET status = ?
       WHERE id = ? AND agency_id = ?`,
      status,
      id,
      ctx.agencyId
    );

    const updated = await db.get(
      `SELECT id, title, status, due_at, created_at
       FROM schedule_tasks
       WHERE id = ? AND agency_id = ?
       LIMIT 1`,
      id,
      ctx.agencyId
    );

    return Response.json({ ok: true, task: updated ?? null });
  } catch (err: any) {
    const code = String(err?.code ?? err?.message ?? err);
    if (code === "UNAUTHENTICATED") return Response.json({ error: "Unauthorized" }, { status: 401 });
    if (code === "FORBIDDEN_NOT_ACTIVE") return Response.json({ error: "Forbidden" }, { status: 403 });

    const msg = String(err?.message ?? err);
    if (msg === "BOT_NOT_FOUND") return Response.json({ ok: false, error: "Bot not found" }, { status: 404 });

    console.error("SCHEDULE_TASKS_PATCH_ERROR", err);
    return Response.json({ error: "Server error", message: msg }, { status: 500 });
  }
}