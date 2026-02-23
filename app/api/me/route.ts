// app/api/me/route.ts
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getDb, type Db } from "@/lib/db";
import { ensureSchema } from "@/lib/schema";
import { requireActiveMember } from "@/lib/authz";
import { getPlanLimits, normalizePlan } from "@/lib/plans";
import { normalizeUserRole, normalizeUserStatus } from "@/lib/users";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function todayYmd() {
  const d = new Date();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function secondsUntilUtcMidnight() {
  const now = new Date();
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0));
  return Math.max(0, Math.floor((next.getTime() - now.getTime()) / 1000));
}

function defaultDailyMessagesForPlan(plan: string) {
  if (plan === "free") return 20;
  if (plan === "starter") return 500;
  return null; // Pro+ unlimited
}

async function getDailyUsage(db: Db, agencyId: string, date: string) {
  const row = (await db.get(
    `SELECT messages_count, uploads_count
     FROM usage_daily
     WHERE agency_id = ? AND date = ?
     LIMIT 1`,
    agencyId,
    date
  )) as { messages_count?: number; uploads_count?: number } | undefined;

  return {
    messages_count: Number(row?.messages_count ?? 0),
    uploads_count: Number(row?.uploads_count ?? 0),
  };
}

async function ensureAgencyBillingColumns(db: Db) {
  await db.run(`ALTER TABLE agencies ADD COLUMN stripe_customer_id TEXT`).catch(() => {});
  await db.run(`ALTER TABLE agencies ADD COLUMN stripe_subscription_id TEXT`).catch(() => {});
  await db.run(`ALTER TABLE agencies ADD COLUMN stripe_price_id TEXT`).catch(() => {});
  await db.run(`ALTER TABLE agencies ADD COLUMN stripe_current_period_end TEXT`).catch(() => {});
}

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireActiveMember(req);

    const db: Db = await getDb();
    await ensureSchema(db);
    await ensureAgencyBillingColumns(db);

    const agency = (await db.get(
      `SELECT id, name, email, plan, stripe_customer_id, stripe_subscription_id, stripe_price_id, stripe_current_period_end
       FROM agencies
       WHERE id = ?
       LIMIT 1`,
      ctx.agencyId
    )) as
      | {
          id: string;
          name: string | null;
          email: string | null;
          plan: string | null;
          stripe_customer_id: string | null;
          stripe_subscription_id: string | null;
          stripe_price_id: string | null;
          stripe_current_period_end: string | null;
        }
      | undefined;

    const user = (await db.get(
      `SELECT id, email, email_verified, role, status
       FROM users
       WHERE agency_id = ? AND id = ?
       LIMIT 1`,
      ctx.agencyId,
      ctx.userId
    )) as
      | {
          id: string;
          email: string;
          email_verified: number | null;
          role: string | null;
          status: string | null;
        }
      | undefined;

    // Authoritative plan is agencies.plan (webhook writes it). Fall back to ctx.plan.
    const rawPlan = agency?.plan ?? (ctx as any)?.plan ?? "free";
    const plan = normalizePlan(rawPlan);
    const limits = getPlanLimits(plan);

    // Usage (messages)
    let dailyLimit: number | null = (limits as any)?.daily_messages ?? null;
    if (dailyLimit != null && Number(dailyLimit) <= 0) dailyLimit = null;

    if (dailyLimit == null) {
      const fallback = defaultDailyMessagesForPlan(plan);
      if (fallback != null) dailyLimit = fallback;
    }

    const date = todayYmd();
    const usage = await getDailyUsage(db, ctx.agencyId, date);

    const daily_remaining =
      dailyLimit == null ? null : Math.max(0, Number(dailyLimit) - Number(usage.messages_count));

    // Documents count (agency-scoped)
    const docsRow = (await db.get(
      `SELECT COUNT(1) as c
       FROM documents
       WHERE agency_id = ?`,
      ctx.agencyId
    )) as { c?: number } | undefined;

    const role = normalizeUserRole(user?.role ?? (ctx as any)?.role);
    const status = normalizeUserStatus(user?.status ?? (ctx as any)?.status);

    return NextResponse.json({
      ok: true,

      // ✅ Standardized plan payload for all UI
      plan,
      limits,

      agency: {
        id: agency?.id ?? ctx.agencyId,
        name: agency?.name ?? null,
        email: agency?.email ?? (ctx as any)?.agencyEmail ?? null,
        plan: plan,
        stripe_customer_id: agency?.stripe_customer_id ?? null,
        stripe_subscription_id: agency?.stripe_subscription_id ?? null,
        stripe_price_id: agency?.stripe_price_id ?? null,
        stripe_current_period_end: agency?.stripe_current_period_end ?? null,
      },

      user: {
        id: user?.id ?? ctx.userId,
        email: user?.email ?? (ctx as any)?.userEmail ?? (ctx as any)?.agencyEmail ?? "",
        email_verified: Number(user?.email_verified ?? 0),
        role,
        status,
        is_owner_admin: status === "active" && (role === "owner" || role === "admin"),
      },

      documents_count: Number(docsRow?.c ?? 0),

      // Chat page expects these
      daily_remaining, // null => unlimited
      daily_resets_in_seconds: secondsUntilUtcMidnight(),

      // Helpful to clients doing seat/bot UI math
      usage: {
        date,
        messages_count: Number(usage.messages_count),
        uploads_count: Number(usage.uploads_count),
        daily_limit: dailyLimit,
        daily_remaining,
      },
    });
  } catch (err: any) {
    const code = String(err?.code ?? err?.message ?? err);
    if (code === "UNAUTHENTICATED") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (code === "FORBIDDEN_NOT_ACTIVE") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    return NextResponse.json({ error: "Server error", message: String(err?.message ?? err) }, { status: 500 });
  }
}