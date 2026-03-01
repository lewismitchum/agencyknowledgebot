import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getDb, type Db } from "@/lib/db";
import { ensureSchema } from "@/lib/schema";
import { requireActiveMember } from "@/lib/authz";
import { normalizePlan, type PlanKey } from "@/lib/plans";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SCHEDULE_PLANS: PlanKey[] = ["starter", "pro", "enterprise", "corporation"];

function isScheduleEnabled(plan: PlanKey) {
  return SCHEDULE_PLANS.includes(plan);
}

export async function GET(req: NextRequest) {
  try {
    const session = await requireActiveMember(req);

    const db: Db = await getDb();
    await ensureSchema(db);

    const agency = (await db.get(`SELECT plan FROM agencies WHERE id = ?`, session.agencyId)) as
      | { plan?: string | null }
      | undefined;

    const plan = normalizePlan(agency?.plan ?? session.plan ?? "free");

    if (!isScheduleEnabled(plan)) {
      return NextResponse.json({ error: "SCHEDULE_NOT_ENABLED" }, { status: 403 });
    }

    const now = new Date();
    const in7Days = new Date(now.getTime());
    in7Days.setDate(in7Days.getDate() + 7);

    const events = await db.all(
      `
      SELECT
        id,
        title,
        start_at AS start_time
      FROM schedule_events
      WHERE agency_id = ?
        AND start_at BETWEEN ? AND ?
      ORDER BY start_at ASC
      LIMIT 10
      `,
      session.agencyId,
      now.toISOString(),
      in7Days.toISOString()
    );

    const tasks = await db.all(
      `
      SELECT
        id,
        title,
        due_at AS due_date
      FROM schedule_tasks
      WHERE agency_id = ?
        AND status = 'open'
      ORDER BY COALESCE(due_at, '9999-12-31T00:00:00.000Z') ASC
      LIMIT 10
      `,
      session.agencyId
    );

    const extractions = await db.all(
      `
      SELECT
        id,
        document_id,
        created_at
      FROM extractions
      WHERE agency_id = ?
      ORDER BY created_at DESC
      LIMIT 5
      `,
      session.agencyId
    );

    return NextResponse.json({
      events: Array.isArray(events) ? events : [],
      tasks: Array.isArray(tasks) ? tasks : [],
      extractions: Array.isArray(extractions) ? extractions : [],
    });
  } catch (err: any) {
    const code = String(err?.code ?? err?.message ?? err);

    if (code === "UNAUTHENTICATED") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (code === "FORBIDDEN_NOT_ACTIVE") {
      return NextResponse.json({ error: "Pending approval" }, { status: 403 });
    }

    console.error("NOTIFICATIONS_GET_ERROR", err);
    return NextResponse.json(
      { error: "Server error", message: String(err?.message ?? err) },
      { status: 500 }
    );
  }
}