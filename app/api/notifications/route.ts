// app/api/notifications/route.ts
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getDb, type Db } from "@/lib/db";
import { ensureSchema } from "@/lib/schema";
import { requireActiveMember } from "@/lib/authz";
import { hasFeature, normalizePlan } from "@/lib/plans";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Upsell = { code?: string; message?: string };

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireActiveMember(req);

    const db: Db = await getDb();
    await ensureSchema(db);

    const agency = (await db.get(
      `SELECT plan
       FROM agencies
       WHERE id = ?
       LIMIT 1`,
      ctx.agencyId
    )) as { plan: string | null } | undefined;

    const plan = normalizePlan(agency?.plan ?? (ctx as any)?.plan ?? "free");

    // Notifications page is visible to all plans.
    // But schedule-derived data is a paid feature; free gets empty arrays + an upsell hint.
    const scheduleEnabled = hasFeature(plan, "schedule");

    const upsell: Upsell | null = scheduleEnabled
      ? null
      : {
          code: "UPSELL_SCHEDULE",
          message:
            "Upgrade to unlock schedule + task notifications (auto-extracted from docs).",
        };

    if (!scheduleEnabled) {
      return NextResponse.json({
        ok: true,
        plan,
        upsell,
        events: [],
        tasks: [],
        extractions: [],
      });
    }

    const nowIso = new Date().toISOString();

    const events = (await db.all(
      `SELECT id, title, start_time
       FROM schedule_events
       WHERE agency_id = ?
         AND start_time >= ?
       ORDER BY start_time ASC
       LIMIT 10`,
      ctx.agencyId,
      nowIso
    )) as Array<{ id: string; title: string; start_time: string }>;

    // Prefer "status" if present, otherwise completed_at semantics.
    // (If your schema only has one of these, ensureSchema should create canonical columns.)
    const tasks = (await db.all(
      `SELECT id, title, due_date
       FROM schedule_tasks
       WHERE agency_id = ?
         AND (status IS NULL OR lower(status) != 'done')
       ORDER BY
         CASE WHEN due_date IS NULL THEN 1 ELSE 0 END,
         due_date ASC
       LIMIT 25`,
      ctx.agencyId
    )) as Array<{ id: string; title: string; due_date: string | null }>;

    const extractions = (await db.all(
      `SELECT id, document_id, created_at
       FROM extractions
       WHERE agency_id = ?
       ORDER BY created_at DESC
       LIMIT 25`,
      ctx.agencyId
    )) as Array<{ id: string; document_id: string; created_at: string }>;

    return NextResponse.json({
      ok: true,
      plan,
      upsell,
      events: events ?? [],
      tasks: tasks ?? [],
      extractions: extractions ?? [],
    });
  } catch (err: any) {
    const code = String(err?.code ?? err?.message ?? err);
    if (code === "UNAUTHENTICATED") {
      return NextResponse.json({ ok: false, error: "UNAUTHENTICATED" }, { status: 401 });
    }
    if (code === "FORBIDDEN_NOT_ACTIVE") {
      return NextResponse.json({ ok: false, error: "FORBIDDEN_NOT_ACTIVE" }, { status: 403 });
    }
    console.error("NOTIFICATIONS_GET_ERROR", err);
    return NextResponse.json(
      { ok: false, error: "INTERNAL_ERROR", message: String(err?.message ?? err) },
      { status: 500 }
    );
  }
}