// app/api/email/drafts/save/route.ts
import { NextRequest, NextResponse } from "next/server";
import { requireActiveMember } from "@/lib/authz";
import { getDb, type Db } from "@/lib/db";
import { ensureSchema } from "@/lib/schema";
import { getAgencyPlan } from "@/lib/enforcement";
import { normalizePlan, requireFeature } from "@/lib/plans";
import { enforceRateLimit } from "@/lib/rate-limit";
import crypto from "crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function ensureEmailDraftsTable(db: Db) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS email_drafts (
      id TEXT PRIMARY KEY,
      agency_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      bot_id TEXT NOT NULL,
      subject TEXT,
      body TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_email_drafts_agency_user_created
      ON email_drafts(agency_id, user_id, created_at DESC);

    CREATE INDEX IF NOT EXISTS idx_email_drafts_bot
      ON email_drafts(bot_id);
  `);
}

function safeString(v: any) {
  return String(v ?? "").trim();
}

function sanitizeError(err: any) {
  return {
    name: String(err?.name || ""),
    message: String(err?.message || ""),
    code: String(err?.code || ""),
  };
}

export async function POST(req: NextRequest) {
  let where = "start";

  try {
    where = "requireActiveMember";
    const session = await requireActiveMember(req);

    where = "db";
    const db: Db = await getDb();
    await ensureSchema(db);
    await ensureEmailDraftsTable(db);

    where = "plan_gate";
    const rawPlan = await getAgencyPlan(db, session.agencyId, session.plan);
    const planKey = normalizePlan(rawPlan);

    const gate = requireFeature(planKey, "email");
    if (!gate.ok) {
      return NextResponse.json(
        { ok: false, error: "Email is available on Corporation.", code: "upgrade_required" },
        { status: 403 }
      );
    }

    where = "rate_limit";
    await enforceRateLimit({
      userId: session.userId,
      agencyId: session.agencyId,
      key: "email_draft_save",
      perMinute: 60,
      perHour: 2000,
    });

    where = "body";
    const body = await req.json().catch(() => ({}));

    const draftId = safeString(body?.id) || crypto.randomUUID();
    const botId = safeString(body?.bot_id);
    const subject = safeString(body?.subject);
    const emailBody = safeString(body?.body);

    if (!botId) {
      return NextResponse.json({ ok: false, error: "MISSING_BOT_ID" }, { status: 400 });
    }

    const now = new Date().toISOString();

    await db.run(
      `
      INSERT INTO email_drafts
        (id, agency_id, user_id, bot_id, subject, body, created_at, updated_at)
      VALUES
        (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        subject = excluded.subject,
        body = excluded.body,
        updated_at = excluded.updated_at
      `,
      draftId,
      session.agencyId,
      session.userId,
      botId,
      subject,
      emailBody,
      now,
      now
    );

    return NextResponse.json({
      ok: true,
      draft_id: draftId,
    });
  } catch (err: any) {
    console.error("EMAIL_DRAFT_SAVE_ERROR", err);

    return NextResponse.json(
      { ok: false, error: "Internal server error", where, details: sanitizeError(err) },
      { status: 500 }
    );
  }
}