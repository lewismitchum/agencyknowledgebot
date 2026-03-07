// app/api/email/drafts/route.ts
import { NextRequest, NextResponse } from "next/server";
import { requireActiveMember } from "@/lib/authz";
import { getDb, type Db } from "@/lib/db";
import { ensureSchema } from "@/lib/schema";
import { getAgencyPlan } from "@/lib/enforcement";
import { normalizePlan, requireFeature } from "@/lib/plans";
import { enforceRateLimit } from "@/lib/rate-limit";

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

function safeInt(v: any, fallback: number) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function safeString(v: any) {
  return String(v ?? "").trim();
}

function sanitizeError(err: any) {
  const message = String(err?.message || "");
  const name = String(err?.name || "");
  const code = String(err?.code || "");
  return {
    name: name || undefined,
    message: message || undefined,
    code: code || undefined,
  };
}

export async function GET(req: NextRequest) {
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
        {
          ok: false,
          error: "Email is available on Corporation.",
          code: "upgrade_required",
          plan: planKey,
        },
        { status: 403 }
      );
    }

    where = "rate_limit";
    await enforceRateLimit({
      userId: session.userId,
      agencyId: session.agencyId,
      key: "email_drafts_list",
      perMinute: 30,
      perHour: 1000,
    });

    const url = new URL(req.url);
    const limit = Math.min(100, Math.max(1, safeInt(url.searchParams.get("limit"), 50)));
    const botId = safeString(url.searchParams.get("bot_id"));

    where = "query";
    const rows = botId
      ? ((await db.all(
          `
          SELECT id, bot_id, subject, created_at
          FROM email_drafts
          WHERE agency_id = ?
            AND user_id = ?
            AND bot_id = ?
          ORDER BY datetime(created_at) DESC
          LIMIT ?
          `,
          session.agencyId,
          session.userId,
          botId,
          limit
        )) as Array<{
          id?: string | null;
          bot_id?: string | null;
          subject?: string | null;
          created_at?: string | null;
        }>)
      : ((await db.all(
          `
          SELECT id, bot_id, subject, created_at
          FROM email_drafts
          WHERE agency_id = ?
            AND user_id = ?
          ORDER BY datetime(created_at) DESC
          LIMIT ?
          `,
          session.agencyId,
          session.userId,
          limit
        )) as Array<{
          id?: string | null;
          bot_id?: string | null;
          subject?: string | null;
          created_at?: string | null;
        }>);

    const drafts = rows
      .map((r) => ({
        id: safeString(r.id),
        bot_id: safeString(r.bot_id),
        subject: safeString(r.subject) || "(no subject)",
        created_at: safeString(r.created_at),
      }))
      .filter((r) => r.id);

    return NextResponse.json({
      ok: true,
      drafts,
    });
  } catch (err: any) {
    const msg = String(err?.message || "");
    if (msg.includes("Too many requests") || msg.includes("Hourly limit")) {
      return NextResponse.json(
        { ok: false, error: msg, code: "rate_limited", where: "rate_limit" },
        { status: 429 }
      );
    }

    console.error("EMAIL_DRAFTS_LIST_ERROR", err);
    return NextResponse.json(
      { ok: false, error: "Internal server error", code: "internal", where, details: sanitizeError(err) },
      { status: 500 }
    );
  }
}