// app/api/me/route.ts
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { getDb, type Db } from "@/lib/db";
import { ensureSchema } from "@/lib/schema";
import { requireActiveMember } from "@/lib/authz";
import { getPlanLimits, normalizePlan } from "@/lib/plans";
import { normalizeUserRole, normalizeUserStatus } from "@/lib/users";
import { openai } from "@/lib/openai";
import { ensureUsageDailySchema } from "@/lib/usage";
import { getEffectiveTimezone, ymdInTz } from "@/lib/timezone";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// NOTE: still UTC-based (safe/consistent). If you want TZ-midnight countdown, we can add a TZ-aware version next.
function secondsUntilUtcMidnight() {
  const now = new Date();
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0));
  return Math.max(0, Math.floor((next.getTime() - now.getTime()) / 1000));
}

async function ensureAgencyBillingColumns(db: Db) {
  await db.run(`ALTER TABLE agencies ADD COLUMN stripe_customer_id TEXT`).catch(() => {});
  await db.run(`ALTER TABLE agencies ADD COLUMN stripe_subscription_id TEXT`).catch(() => {});
  await db.run(`ALTER TABLE agencies ADD COLUMN stripe_price_id TEXT`).catch(() => {});
  await db.run(`ALTER TABLE agencies ADD COLUMN stripe_current_period_end TEXT`).catch(() => {});
  await db.run(`ALTER TABLE agencies ADD COLUMN trial_used INTEGER`).catch(() => {});
  await db.run(`ALTER TABLE agencies ADD COLUMN timezone TEXT`).catch(() => {});
}

async function ensureUserColumns(db: Db) {
  await db.run(`ALTER TABLE users ADD COLUMN role TEXT`).catch(() => {});
  await db.run(`ALTER TABLE users ADD COLUMN status TEXT`).catch(() => {});
  await db.run(`ALTER TABLE users ADD COLUMN email_verified INTEGER`).catch(() => {});
  await db.run(`ALTER TABLE users ADD COLUMN has_completed_onboarding INTEGER`).catch(() => {});

  // ✅ Timezone (canonical + legacy drift safety)
  await db.run(`ALTER TABLE users ADD COLUMN time_zone TEXT`).catch(() => {});
  await db.run(`ALTER TABLE users ADD COLUMN time_zone_updated_at TEXT`).catch(() => {});
  await db.run(`ALTER TABLE users ADD COLUMN timezone TEXT`).catch(() => {});
  await db.run(`ALTER TABLE users ADD COLUMN timezone_updated_at TEXT`).catch(() => {});

  // ✅ Backfill canonical from legacy if needed
  await db.run(`
    UPDATE users
    SET time_zone = timezone
    WHERE (time_zone IS NULL OR time_zone = '')
      AND timezone IS NOT NULL
      AND timezone <> '';
  `).catch(() => {});
}

async function ensureDefaultAgencyBot(db: Db, agencyId: string) {
  const existing = (await db.get(
    `SELECT id, name, vector_store_id
     FROM bots
     WHERE agency_id = ? AND owner_user_id IS NULL
     ORDER BY created_at ASC
     LIMIT 1`,
    agencyId
  )) as { id: string; name: string | null; vector_store_id: string | null } | undefined;

  if (existing?.id) {
    const vsId = String(existing.vector_store_id ?? "").trim();
    if (vsId) return;

    const vs = await openai.vectorStores.create({ name: existing.name ?? "Agency Bot" });
    await db.run(`UPDATE bots SET vector_store_id = ? WHERE id = ? AND agency_id = ?`, vs.id, existing.id, agencyId);
    return;
  }

  const botId = randomUUID();
  const botName = "Agency Bot";
  const vs = await openai.vectorStores.create({ name: botName });

  try {
    await db.run(
      `INSERT INTO bots (id, agency_id, name, owner_user_id, vector_store_id, created_at)
       VALUES (?, ?, ?, NULL, ?, ?)`,
      botId,
      agencyId,
      botName,
      vs.id,
      new Date().toISOString()
    );
  } catch (e) {
    try {
      await openai.vectorStores.delete(vs.id);
    } catch {}
    throw e;
  }
}

function toUiDailyLimit(raw: unknown): number | null {
  const n = typeof raw === "number" ? raw : raw == null ? null : Number(raw);
  if (n == null || !Number.isFinite(n)) return null;
  if (n <= 0) return null;
  if (n >= 90000) return null;
  return Math.floor(n);
}

function daysLeftFromPeriodEnd(iso: string | null | undefined) {
  if (!iso) return null;
  const end = new Date(String(iso));
  if (!Number.isFinite(end.getTime())) return null;
  const now = new Date();
  const ms = end.getTime() - now.getTime();
  const days = Math.ceil(ms / (1000 * 60 * 60 * 24));
  return Math.max(0, days);
}

function isTierSwitcherEnabledFor(ctx: { userId: string; agencyId: string }) {
  if (process.env.NODE_ENV === "production") return false;

  const allowUser = String(process.env.TIER_SWITCHER_USER_ID ?? "").trim();
  const allowAgency = String(process.env.TIER_SWITCHER_AGENCY_ID ?? "").trim();

  if (allowUser && ctx.userId === allowUser) return true;
  if (allowAgency && ctx.agencyId === allowAgency) return true;

  return false;
}

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireActiveMember(req);

    const db: Db = await getDb();
    await ensureSchema(db);

    await ensureAgencyBillingColumns(db);
    await ensureUserColumns(db);
    await ensureUsageDailySchema(db);

    await ensureDefaultAgencyBot(db, ctx.agencyId);

    const agency = (await db.get(
      `SELECT id, name, email, plan,
              stripe_customer_id, stripe_subscription_id, stripe_price_id, stripe_current_period_end,
              trial_used,
              timezone
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
          trial_used: number | null;
          timezone: string | null;
        }
      | undefined;

    const user = (await db.get(
      `SELECT id, email, email_verified, role, status, has_completed_onboarding,
              time_zone, timezone
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
          has_completed_onboarding: number | null;
          time_zone: string | null;
          timezone: string | null;
        }
      | undefined;

    const rawPlan = agency?.plan ?? (ctx as any)?.plan ?? "free";
    const plan = normalizePlan(rawPlan);
    const limits = getPlanLimits(plan);

    const dailyMsgLimit = toUiDailyLimit((limits as any)?.daily_messages);
    const dailyUploadLimit = toUiDailyLimit((limits as any)?.daily_uploads);

    // ✅ Travel-proof tz: header -> users.time_zone -> users.timezone -> agencies.timezone -> America/Chicago
    const tz = await getEffectiveTimezone(db, {
      agencyId: ctx.agencyId,
      userId: ctx.userId,
      headers: req.headers,
    });

    // ✅ Usage day key anchored to viewer’s effective timezone (same as chat/upload)
    const dateKey = ymdInTz(new Date(), tz);

    const { getUsageRow } = await import("@/lib/usage");
    const usage = await getUsageRow(db, ctx.agencyId, dateKey);

    const daily_remaining =
      dailyMsgLimit == null ? null : Math.max(0, dailyMsgLimit - Number(usage.messages_count ?? 0));

    const uploads_used = Number(usage.uploads_count ?? 0);
    const uploads_limit = dailyUploadLimit; // null => unlimited
    const uploads_remaining = uploads_limit == null ? null : Math.max(0, uploads_limit - uploads_used);

    const docsRow = (await db.get(
      `SELECT COUNT(1) as c
       FROM documents
       WHERE agency_id = ?`,
      ctx.agencyId
    )) as { c?: number } | undefined;

    const role = normalizeUserRole((user as any)?.role ?? (ctx as any)?.role);
    const status = normalizeUserStatus((user as any)?.status ?? (ctx as any)?.status);

    const trial_used = Number((agency as any)?.trial_used ?? 0) === 1 ? 1 : 0;
    const trial_days_left = daysLeftFromPeriodEnd(agency?.stripe_current_period_end);

    const userTz = String(user?.time_zone ?? "").trim() || String(user?.timezone ?? "").trim() || "";

    return NextResponse.json({
      ok: true,

      agency: {
        id: agency?.id ?? ctx.agencyId,
        name: agency?.name ?? null,
        email: agency?.email ?? (ctx as any)?.agencyEmail ?? null,
        plan: agency?.plan ?? ((ctx as any)?.plan ?? "free"),
        stripe_customer_id: agency?.stripe_customer_id ?? null,
        stripe_subscription_id: agency?.stripe_subscription_id ?? null,
        stripe_price_id: agency?.stripe_price_id ?? null,
        stripe_current_period_end: agency?.stripe_current_period_end ?? null,
        trial_used,
        trial_days_left,
        timezone: String(agency?.timezone ?? "").trim() || tz,
      },

      user: {
        id: user?.id ?? ctx.userId,
        email: user?.email ?? (ctx as any)?.userEmail ?? (ctx as any)?.agencyEmail ?? "",
        email_verified: Number((user as any)?.email_verified ?? 0),
        role,
        status,
        has_completed_onboarding: Number((user as any)?.has_completed_onboarding ?? 0) === 1 ? 1 : 0,

        // ✅ canonical key the client should use
        time_zone: userTz || tz || null,

        // ✅ optional legacy echo
        timezone: userTz || tz || null,
      },

      plan,
      limits,

      tier_switcher_enabled: isTierSwitcherEnabledFor({ userId: ctx.userId, agencyId: ctx.agencyId }),

      documents_count: Number(docsRow?.c ?? 0),

      daily_remaining,
      daily_resets_in_seconds: secondsUntilUtcMidnight(),

      uploads_used,
      uploads_limit,
      uploads_remaining,
      usage_day: dateKey,
    });
  } catch (err: any) {
    const code = String(err?.code ?? err?.message ?? err);
    if (code === "UNAUTHENTICATED") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (code === "FORBIDDEN_NOT_ACTIVE") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    return NextResponse.json({ error: "Server error", message: String(err?.message ?? err) }, { status: 500 });
  }
}