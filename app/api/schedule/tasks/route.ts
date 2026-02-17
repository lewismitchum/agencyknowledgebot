// app/api/schedule/tasks/route.ts
import type { NextRequest } from "next/server";
import { getDb, type Db } from "@/lib/db";
import { requireActiveMember } from "@/lib/authz";
import { requireFeature } from "@/lib/plans";

export const runtime = "nodejs";

function requireScheduleOr403(plan: unknown) {
  const gate = requireFeature(plan, "schedule");
  if (gate.ok) return null;
  return Response.json(gate.body, { status: gate.status }); // 403
}

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireActiveMember(req);

    // ✅ Paid-only gate (canonical)
    const gated = requireScheduleOr403(ctx.plan);
    if (gated) return gated;

    const url = new URL(req.url);

    const botId = String(url.searchParams.get("bot_id") || "").trim();
    if (!botId) {
      return Response.json({ ok: false, error: "Missing bot_id" }, { status: 400 });
    }

    const db: Db = await getDb();

    // Ensure bot is in agency and user is allowed to access it
    const bot = (await db.get(
      `SELECT id
       FROM bots
       WHERE id = ? AND agency_id = ?
         AND (owner_user_id IS NULL OR owner_user_id = ?)
       LIMIT 1`,
      botId,
      ctx.agencyId,
      ctx.userId
    )) as { id: string } | undefined;

    if (!bot?.id) {
      return Response.json({ ok: false, error: "Bot not found" }, { status: 404 });
    }

    // Keep query conservative: only select columns that almost certainly exist.
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
    if (code === "UNAUTHENTICATED")
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    if (code === "FORBIDDEN_NOT_ACTIVE")
      return Response.json({ error: "Forbidden" }, { status: 403 });

    console.error("SCHEDULE_TASKS_GET_ERROR", err);
    return Response.json(
      { error: "Server error", message: String(err?.message ?? err) },
      { status: 500 }
    );
  }
}
