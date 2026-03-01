// app/api/onboarding/route.ts
import { NextResponse, type NextRequest } from "next/server";
import { getDb, type Db } from "@/lib/db";
import { ensureSchema } from "@/lib/schema";
import { requireActiveMember } from "@/lib/authz";
import { normalizePlan, type PlanKey } from "@/lib/plans";

export const runtime = "nodejs";

const SCHEDULE_PLANS: PlanKey[] = ["starter", "pro", "enterprise", "corporation"];

function isScheduleEnabled(plan: PlanKey) {
  return SCHEDULE_PLANS.includes(plan);
}

export async function GET(req: NextRequest) {
  try {
    const session = await requireActiveMember(req);

    const db: Db = await getDb();
    await ensureSchema(db);

    const agency = (await db.get(`SELECT plan FROM agencies WHERE id = ? LIMIT 1`, session.agencyId)) as
      | { plan?: string | null }
      | undefined;

    const planKey = normalizePlan(agency?.plan || "free");

    const botsRow = (await db.get(
      `SELECT COUNT(*) AS c FROM bots WHERE agency_id = ?`,
      session.agencyId
    )) as { c?: number } | undefined;

    const docsRow = (await db.get(
      `SELECT COUNT(*) AS c FROM documents WHERE agency_id = ?`,
      session.agencyId
    )) as { c?: number } | undefined;

    return NextResponse.json({
      bots_count: Number(botsRow?.c ?? 0),
      documents_count: Number(docsRow?.c ?? 0),
      plan: planKey,
      schedule_enabled: isScheduleEnabled(planKey),
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
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}