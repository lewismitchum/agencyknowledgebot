// app/api/usage/route.ts
import type { NextRequest } from "next/server";
import { getDb, type Db } from "@/lib/db";
import { requireActiveMember } from "@/lib/authz";
import { ensureSchema } from "@/lib/schema";
import { getPlanLimits, normalizePlan } from "@/lib/plans";
import { ensureUsageDailySchema } from "@/lib/usage";
import { getEffectiveTimezone, ymdInTz } from "@/lib/timezone";

export const runtime = "nodejs";

async function tableHasColumn(db: Db, table: string, column: string) {
  try {
    const rows = (await db.all(`PRAGMA table_info(${table})`)) as Array<{ name?: string }>;
    return rows.some((r) => String(r?.name ?? "").toLowerCase() === column.toLowerCase());
  } catch {
    return false;
  }
}

async function getDailyUsage(db: Db, agencyId: string, userId: string, dateKey: string) {
  // If usage_daily has user_id, use it (per-user daily usage).
  // Otherwise fallback to legacy agency-wide daily usage.
  const hasUserId = await tableHasColumn(db, "usage_daily", "user_id");

  const row = (await db.get(
    hasUserId
      ? `SELECT messages_count, uploads_count
         FROM usage_daily
         WHERE agency_id = ? AND user_id = ? AND date = ?
         LIMIT 1`
      : `SELECT messages_count, uploads_count
         FROM usage_daily
         WHERE agency_id = ? AND date = ?
         LIMIT 1`,
    ...(hasUserId ? ([agencyId, userId, dateKey] as const) : ([agencyId, dateKey] as const))
  )) as { messages_count?: number; uploads_count?: number } | undefined;

  return {
    messages_count: Number(row?.messages_count ?? 0),
    uploads_count: Number(row?.uploads_count ?? 0),
    mode: hasUserId ? ("per_user" as const) : ("agency_wide" as const),
  };
}

export async function OPTIONS() {
  return new Response(null, { status: 204 });
}

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireActiveMember(req);
    const db: Db = await getDb();
    await ensureSchema(db);
    await ensureUsageDailySchema(db);

    const planRow = (await db.get(`SELECT plan FROM agencies WHERE id = ? LIMIT 1`, ctx.agencyId)) as
      | { plan?: string | null }
      | undefined;

    const plan = normalizePlan(planRow?.plan ?? ctx.plan ?? null);
    const limits = getPlanLimits(plan);

    // ✅ Travel-proof timezone: header -> users.time_zone -> users.timezone -> agencies.timezone -> America/Chicago
    const tz = await getEffectiveTimezone(db, {
      agencyId: ctx.agencyId,
      userId: ctx.userId,
      headers: req.headers,
    });

    // Daily usage should key off the viewer/user’s local day
    const dateKey = ymdInTz(new Date(), tz);

    const usage = await getDailyUsage(db, ctx.agencyId, ctx.userId, dateKey);

    return Response.json({
      ok: true,
      plan,
      timezone: tz,
      date: dateKey,
      usage_mode: usage.mode,
      usage: {
        messages_used: usage.messages_count,
        uploads_used: usage.uploads_count,
      },
      limits: {
        daily_messages: limits.daily_messages,
        daily_uploads: limits.daily_uploads,
      },
    });
  } catch (err: any) {
    const code = String(err?.code ?? err?.message ?? err);
    if (code === "UNAUTHENTICATED") return Response.json({ error: "Unauthorized" }, { status: 401 });
    if (code === "FORBIDDEN_NOT_ACTIVE") return Response.json({ error: "Forbidden" }, { status: 403 });

    console.error("USAGE_GET_ERROR", err);
    return Response.json({ error: "Server error", message: String(err?.message ?? err) }, { status: 500 });
  }
}