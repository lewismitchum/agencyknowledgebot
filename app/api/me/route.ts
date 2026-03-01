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

async function ensureAgencyBillingColumns(db: Db) {
  await db.run(`ALTER TABLE agencies ADD COLUMN stripe_customer_id TEXT`).catch(() => {});
  await db.run(`ALTER TABLE agencies ADD COLUMN stripe_subscription_id TEXT`).catch(() => {});
  await db.run(`ALTER TABLE agencies ADD COLUMN stripe_price_id TEXT`).catch(() => {});
  await db.run(`ALTER TABLE agencies ADD COLUMN stripe_current_period_end TEXT`).catch(() => {});
  await db.run(`ALTER TABLE agencies ADD COLUMN trial_used INTEGER`).catch(() => {});
}

async function ensureUserColumns(db: Db) {
  await db.run(`ALTER TABLE users ADD COLUMN role TEXT`).catch(() => {});
  await db.run(`ALTER TABLE users ADD COLUMN status TEXT`).catch(() => {});
  await db.run(`ALTER TABLE users ADD COLUMN email_verified INTEGER`).catch(() => {});
  await db.run(`ALTER TABLE users ADD COLUMN has_completed_onboarding INTEGER`).catch(() => {});
}

async function ensureUsageDailyColumns(db: Db) {
  await db.run(`ALTER TABLE usage_daily ADD COLUMN messages_count INTEGER`).catch(() => {});
  await db.run(`ALTER TABLE usage_daily ADD COLUMN uploads_count INTEGER`).catch(() => {});
}

async function ensureDefaultAgencyBot(db: Db, agencyId: string) {
  // Idempotent:
  // - If no agency bot exists, create one + vector store.
  // - If agency bot exists but vector_store_id is NULL/empty, repair by creating VS + updating row.
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

function toUiDailyLimit(raw: unknown): number | null {
  // Canonical: unlimited must be NULL (never 99999 / huge sentinel).
  const n = typeof raw === "number" ? raw : raw == null ? null : Number(raw);
  if (n == null || !Number.isFinite(n)) return null;
  if (n <= 0) return null;
  if (n >= 90000) return null;
  return Math.floor(n);
}

function pickUploadsLimit(limits: any): number | null {
  // Accept a few names to avoid “limits drift”
  return toUiDailyLimit(
    limits?.daily_uploads ??
      limits?.dailyUploads ??
      limits?.uploads_daily ??
      limits?.daily_upload_limit ??
      limits?.daily_uploads_limit ??
      limits?.daily_upload ??
      null
  );
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
    await ensureUsageDailyColumns(db);

    // ✅ Ensure agency always has a shared bot with a vector store
    await ensureDefaultAgencyBot(db, ctx.agencyId);

    const agency = (await db.get(
      `SELECT id, name, email, plan,
              stripe_customer_id, stripe_subscription_id, stripe_price_id, stripe_current_period_end,
              trial_used
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
        }
      | undefined;

    const user = (await db.get(
      `SELECT id, email, email_verified, role, status, has_completed_onboarding
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
        }
      | undefined;

    const rawPlan = agency?.plan ?? (ctx as any)?.plan ?? "free";
    const plan = normalizePlan(rawPlan);
    const limits = getPlanLimits(plan);

    const date = todayYmd();
    const usage = await getDailyUsage(db, ctx.agencyId, date);

    // Messages (chat)
    const dailyMsgLimit = toUiDailyLimit((limits as any)?.daily_messages);
    const daily_remaining =
      dailyMsgLimit == null ? null : Math.max(0, dailyMsgLimit - Number(usage.messages_count));

    // Uploads (docs)
    const uploads_limit = pickUploadsLimit(limits);
    const uploads_used = Math.max(0, Number(usage.uploads_count ?? 0));
    const uploads_remaining =
      uploads_limit == null ? null : Math.max(0, uploads_limit - uploads_used);

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
      },

      user: {
        id: user?.id ?? ctx.userId,
        email: user?.email ?? (ctx as any)?.userEmail ?? (ctx as any)?.agencyEmail ?? "",
        email_verified: Number((user as any)?.email_verified ?? 0),
        role,
        status,
        has_completed_onboarding: Number((user as any)?.has_completed_onboarding ?? 0) === 1 ? 1 : 0,
      },

      // ✅ Used by UI (Bots/Billing/Docs)
      plan,
      limits,
      tier_switcher_enabled: isTierSwitcherEnabledFor({ userId: ctx.userId, agencyId: ctx.agencyId }),

      documents_count: Number(docsRow?.c ?? 0),

      // ✅ Docs page expects these
      uploads_used,
      uploads_limit, // null => unlimited
      uploads_remaining, // null => unlimited

      // ✅ Chat page expects these
      daily_remaining, // null => unlimited
      daily_resets_in_seconds: secondsUntilUtcMidnight(),
    });
  } catch (err: any) {
    const code = String(err?.code ?? err?.message ?? err);
    if (code === "UNAUTHENTICATED") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (code === "FORBIDDEN_NOT_ACTIVE") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    return NextResponse.json({ error: "Server error", message: String(err?.message ?? err) }, { status: 500 });
  }
}