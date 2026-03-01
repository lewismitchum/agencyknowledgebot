// app/api/notifications/route.ts
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
    const scheduleEnabled = isScheduleEnabled(planKey);

    const notices = [
      {
        id: "n_docs_first",
        title: "Docs-first answers",
        body: "For internal questions, Louis prioritizes your uploads and stays honest when the docs don’t support it.",
      },
    ];

    if (!scheduleEnabled) {
      // Notifications page exists for all tiers; schedule feed is gated.
      return NextResponse.json({
        plan: planKey,
        schedule_enabled: false,
        events: [],
        tasks: [],
        extractions: [],
        notices: [
          ...notices,
          {
            id: "n_upgrade_schedule",
            title: "Upgrade for schedule notifications",
            body: "Unlock schedule, tasks, and extraction notifications on Starter+.",
          },
        ],
      });
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
      plan: planKey,
      schedule_enabled: true,
      events: Array.isArray(events) ? events : [],
      tasks: Array.isArray(tasks) ? tasks : [],
      extractions: Array.isArray(extractions) ? extractions : [],
      notices,
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
    return NextResponse.json({ error: "Server error", message: String(err?.message ?? err) }, { status: 500 });
  }
}