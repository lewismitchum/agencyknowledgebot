import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import * as auth from "@/lib/auth";
import { normalizePlan } from "@/lib/plans";

const requireActiveMember: (req: Request) => Promise<any> =
  (auth as any).requireActiveMember ?? (auth as any).requireMember ?? (auth as any).requireUser ??
  (async () => {
    throw new Error('requireActiveMember not found in "@/lib/auth"');
  });

export async function GET(req: Request) {
  const session = await requireActiveMember(req);
  const db = await getDb();

  const agency = await db.get(
    `SELECT plan FROM agencies WHERE id = ?`,
    session.agencyId
  );

  const plan = normalizePlan(agency?.plan || "free");

  const scheduleEnabled =
    plan === "starter" ||
    plan === "pro" ||
    plan === "enterprise" ||
    plan === "corporation";

  if (!scheduleEnabled) {
    return NextResponse.json({
      events: [],
      tasks: [],
      extractions: [],
      scheduleEnabled: false,
    });
  }

  const now = new Date();
  const in7Days = new Date();
  in7Days.setDate(now.getDate() + 7);

  const events = await db.all(
    `
    SELECT id, title, start_time, end_time, bot_id
    FROM schedule_events
    WHERE agency_id = ?
      AND start_time BETWEEN ? AND ?
    ORDER BY start_time ASC
    LIMIT 10
    `,
    session.agencyId,
    now.toISOString(),
    in7Days.toISOString()
  );

  const tasks = await db.all(
    `
    SELECT id, title, due_date, status, bot_id
    FROM schedule_tasks
    WHERE agency_id = ?
      AND status = 'open'
    ORDER BY due_date ASC
    LIMIT 10
    `,
    session.agencyId
  );

  const extractions = await db.all(
    `
    SELECT id, document_id, created_at, bot_id
    FROM extractions
    WHERE agency_id = ?
    ORDER BY created_at DESC
    LIMIT 5
    `,
    session.agencyId
  );

  return NextResponse.json({
    events,
    tasks,
    extractions,
    scheduleEnabled: true,
  });
}