// app/api/onboarding/route.ts
import { NextResponse, type NextRequest } from "next/server";
import { getDb, type Db } from "@/lib/db";
import { ensureSchema } from "@/lib/schema";
import { requireActiveMember } from "@/lib/authz";
import { normalizePlan, requireFeature } from "@/lib/plans";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function ensureOnboardingColumns(db: Db) {
  const columns = (await db.all(`PRAGMA table_info(users)`)) as Array<{ name?: string }>;

  const hasCreatedFirstBot = columns.some((c) => c?.name === "created_first_bot");
  const hasUploadedFirstDoc = columns.some((c) => c?.name === "uploaded_first_doc");
  const hasSentFirstChat = columns.some((c) => c?.name === "sent_first_chat");
  const hasOpenedSchedule = columns.some((c) => c?.name === "opened_schedule");
  const hasConnectedGmail = columns.some((c) => c?.name === "connected_gmail");
  const hasSummarizedInbox = columns.some((c) => c?.name === "summarized_inbox");

  if (!hasCreatedFirstBot) {
    await db.run(`ALTER TABLE users ADD COLUMN created_first_bot INTEGER NOT NULL DEFAULT 0`);
  }
  if (!hasUploadedFirstDoc) {
    await db.run(`ALTER TABLE users ADD COLUMN uploaded_first_doc INTEGER NOT NULL DEFAULT 0`);
  }
  if (!hasSentFirstChat) {
    await db.run(`ALTER TABLE users ADD COLUMN sent_first_chat INTEGER NOT NULL DEFAULT 0`);
  }
  if (!hasOpenedSchedule) {
    await db.run(`ALTER TABLE users ADD COLUMN opened_schedule INTEGER NOT NULL DEFAULT 0`);
  }
  if (!hasConnectedGmail) {
    await db.run(`ALTER TABLE users ADD COLUMN connected_gmail INTEGER NOT NULL DEFAULT 0`);
  }
  if (!hasSummarizedInbox) {
    await db.run(`ALTER TABLE users ADD COLUMN summarized_inbox INTEGER NOT NULL DEFAULT 0`);
  }
}

export async function GET(req: NextRequest) {
  try {
    const session = await requireActiveMember(req);

    const db: Db = await getDb();
    await ensureSchema(db);
    await ensureOnboardingColumns(db);

    const agency = (await db.get(`SELECT plan FROM agencies WHERE id = ? LIMIT 1`, session.agencyId)) as
      | { plan?: string | null }
      | undefined;

    const planKey = normalizePlan(agency?.plan ?? session.plan ?? "free");
    const scheduleGate = requireFeature(planKey, "schedule");
    const emailGate = requireFeature(planKey, "email");

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

    const docsRow = (await db.get(
      `SELECT COUNT(1) AS c FROM documents WHERE agency_id = ?`,
      session.agencyId
    )) as { c?: number } | undefined;

    const userRow = (await db.get(
      `
      SELECT
        COALESCE(created_first_bot, 0) AS created_first_bot,
        COALESCE(uploaded_first_doc, 0) AS uploaded_first_doc,
        COALESCE(sent_first_chat, 0) AS sent_first_chat,
        COALESCE(opened_schedule, 0) AS opened_schedule,
        COALESCE(connected_gmail, 0) AS connected_gmail,
        COALESCE(summarized_inbox, 0) AS summarized_inbox
      FROM users
      WHERE id = ?
      LIMIT 1
      `,
      session.userId
    )) as
      | {
          created_first_bot?: number | null;
          uploaded_first_doc?: number | null;
          sent_first_chat?: number | null;
          opened_schedule?: number | null;
          connected_gmail?: number | null;
          summarized_inbox?: number | null;
        }
      | undefined;

    const botsCount = Number(botsRow?.c ?? 0);
    const documentsCount = Number(docsRow?.c ?? 0);

    const progress = {
      created_first_bot: Number(userRow?.created_first_bot ?? 0) === 1 || botsCount > 0,
      uploaded_first_doc: Number(userRow?.uploaded_first_doc ?? 0) === 1 || documentsCount > 0,
      sent_first_chat: Number(userRow?.sent_first_chat ?? 0) === 1,
      opened_schedule: Number(userRow?.opened_schedule ?? 0) === 1,
      connected_gmail: emailGate.ok ? Number(userRow?.connected_gmail ?? 0) === 1 : false,
      summarized_inbox: emailGate.ok ? Number(userRow?.summarized_inbox ?? 0) === 1 : false,
    };

    const completedSteps = [
      progress.created_first_bot,
      progress.uploaded_first_doc,
      progress.sent_first_chat,
      progress.opened_schedule,
      emailGate.ok ? progress.connected_gmail : true,
      emailGate.ok ? progress.summarized_inbox : true,
    ].filter(Boolean).length;

    const totalSteps = emailGate.ok ? 6 : 4;

    return NextResponse.json({
      ok: true,
      bots_count: botsCount,
      documents_count: documentsCount,
      plan: planKey,
      schedule_enabled: Boolean(scheduleGate.ok),
      email_enabled: Boolean(emailGate.ok),
      onboarding: {
        ...progress,
        completed_steps: completedSteps,
        total_steps: totalSteps,
        percent: totalSteps > 0 ? Math.round((completedSteps / totalSteps) * 100) : 0,
      },
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

export async function POST(req: NextRequest) {
  try {
    const session = await requireActiveMember(req);

    const db: Db = await getDb();
    await ensureSchema(db);
    await ensureOnboardingColumns(db);

    const body = (await req.json().catch(() => ({}))) as { action?: string } | null;
    const action = String(body?.action ?? "").trim();

    if (!action) {
      return NextResponse.json({ ok: false, error: "MISSING_ACTION" }, { status: 400 });
    }

    if (action === "opened_schedule") {
      await db.run(`UPDATE users SET opened_schedule = 1 WHERE id = ?`, session.userId);
      return NextResponse.json({ ok: true });
    }

    if (action === "connected_gmail") {
      await db.run(`UPDATE users SET connected_gmail = 1 WHERE id = ?`, session.userId);
      return NextResponse.json({ ok: true });
    }

    if (action === "summarized_inbox") {
      await db.run(`UPDATE users SET summarized_inbox = 1 WHERE id = ?`, session.userId);
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ ok: false, error: "INVALID_ACTION" }, { status: 400 });
  } catch (err: any) {
    const code = String(err?.code ?? err?.message ?? err);

    if (code === "UNAUTHENTICATED") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (code === "FORBIDDEN_NOT_ACTIVE") {
      return NextResponse.json({ error: "Pending approval" }, { status: 403 });
    }

    console.error("ONBOARDING_POST_ERROR", err);
    return NextResponse.json({ error: "Server error", message: String(err?.message ?? err) }, { status: 500 });
  }
}