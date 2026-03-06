// app/api/onboarding/route.ts
import { NextResponse, type NextRequest } from "next/server";
import { getDb, type Db } from "@/lib/db";
import { ensureSchema } from "@/lib/schema";
import { requireActiveMember } from "@/lib/authz";
import { normalizePlan, requireFeature } from "@/lib/plans";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const session = await requireActiveMember(req);

    const db: Db = await getDb();
    await ensureSchema(db);

    const agency = (await db.get(`SELECT plan FROM agencies WHERE id = ? LIMIT 1`, session.agencyId)) as
      | { plan?: string | null }
      | undefined;

    const planKey = normalizePlan(agency?.plan ?? session.plan ?? "free");
    const scheduleGate = requireFeature(planKey, "schedule");

    // ✅ bots visible to THIS user:
    // - agency bots
    // - their private bots
    const botsRow = (await db.get(
      `
      SELECT COUNT(1) AS c
      FROM bots
      WHERE agency_id = ?
        AND (owner_user_id IS NULL OR owner_user_id = ?)
      `,
      session.agencyId,
      session.userId
    )) as { c?: number } | undefined;

    // docs are bot-scoped, but onboarding wants "does this workspace have any docs at all?"
    const docsRow = (await db.get(
      `SELECT COUNT(1) AS c FROM documents WHERE agency_id = ?`,
      session.agencyId
    )) as { c?: number } | undefined;

    return NextResponse.json({
      ok: true,
      bots_count: Number(botsRow?.c ?? 0),
      documents_count: Number(docsRow?.c ?? 0),
      plan: planKey,
      schedule_enabled: Boolean(scheduleGate.ok),
    });
  } catch (err: any) {
    const code = String(err?.code ?? err?.message ?? err);

    if (code === "UNAUTHENTICATED") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (code === "FORBIDDEN_NOT_ACTIVE") {
      return NextResponse.json({ error: "Pending approval" }, { status: 403 });
    }

    console.error("ONBOARDING_GET_ERROR", err);
    return NextResponse.json({ error: "Server error", message: String(err?.message ?? err) }, { status: 500 });
  }
}