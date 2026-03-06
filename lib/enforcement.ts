// lib/enforcement.ts
import type { Db } from "@/lib/db";
import { getPlanLimits, normalizePlan, requireFeature, type FeatureKey } from "@/lib/plans";
import { getUserUsageRow } from "@/lib/usage";

export type EnforcementResult = { ok: true } | { ok: false; status: number; body: any };

export async function getAgencyPlan(db: Db, agencyId: string, fallbackPlan?: string | null) {
  const row = (await db.get(`SELECT plan FROM agencies WHERE id = ? LIMIT 1`, String(agencyId))) as
    | { plan: string | null }
    | undefined;

  return normalizePlan(row?.plan ?? fallbackPlan ?? null);
}

export async function enforceDailyMessages(
  db: Db,
  agencyId: string,
  userId: string,
  dateKey: string,
  plan: unknown
): Promise<EnforcementResult> {
  const p = normalizePlan(plan);
  const limits = getPlanLimits(p);

  const limit = limits.daily_messages; // number | null
  if (limit == null) return { ok: true }; // unlimited

  const n = Number(limit);
  if (!Number.isFinite(n) || n <= 0) return { ok: true };

  const usage = await getUserUsageRow(db, agencyId, userId, dateKey);

  if (usage.messages_count >= n) {
    return {
      ok: false,
      status: 429,
      body: {
        ok: false,
        error: "DAILY_LIMIT_EXCEEDED",
        used: usage.messages_count,
        daily_limit: n,
        plan: p,
        date: dateKey,
      },
    };
  }

  return { ok: true };
}

export async function enforceDailyUploads(
  db: Db,
  agencyId: string,
  userId: string,
  dateKey: string,
  plan: unknown,
  attemptedUploads: number
): Promise<EnforcementResult> {
  const p = normalizePlan(plan);
  const limits = getPlanLimits(p);

  if (limits.daily_uploads == null) return { ok: true }; // unlimited

  const limit = Number(limits.daily_uploads);
  if (!Number.isFinite(limit) || limit <= 0) return { ok: true };

  const usage = await getUserUsageRow(db, agencyId, userId, dateKey);

  if (usage.uploads_count + attemptedUploads > limit) {
    return {
      ok: false,
      status: 429,
      body: {
        ok: false,
        error: "DAILY_UPLOAD_LIMIT_EXCEEDED",
        used: usage.uploads_count,
        attempted: attemptedUploads,
        daily_limit: limit,
        plan: p,
        date: dateKey,
      },
    };
  }

  return { ok: true };
}

export function enforceFeature(plan: unknown, feature: FeatureKey): EnforcementResult {
  const r = requireFeature(plan, feature);
  if (r.ok) return { ok: true };
  return { ok: false, status: r.status, body: r.body };
}

/**
 * Billable seats = users in this agency with status active/pending,
 * EXCLUDING owner/admin roles.
 */
export async function enforceSeatLimit(db: Db, agencyId: string, plan: unknown): Promise<EnforcementResult> {
  const p = normalizePlan(plan);
  const limits = getPlanLimits(p);

  const max = limits.max_users;
  if (max == null) return { ok: true }; // unlimited seats

  const row = (await db.get(
    `
    SELECT COUNT(1) AS n
    FROM users
    WHERE agency_id = ?
      AND status IN ('active','pending')
      AND role NOT IN ('owner','admin')
    `,
    String(agencyId)
  )) as { n?: number } | undefined;

  const used = Number(row?.n ?? 0);

  if (used >= max) {
    return {
      ok: false,
      status: 403,
      body: {
        ok: false,
        error: "SEAT_LIMIT_EXCEEDED",
        used,
        max,
        plan: p,
      },
    };
  }

  return { ok: true };
}

/**
 * Agency bots limit = bots where owner_user_id IS NULL (shared bots),
 * EXCLUDING private bots.
 */
export async function enforceAgencyBotLimit(db: Db, agencyId: string, plan: unknown): Promise<EnforcementResult> {
  const p = normalizePlan(plan);
  const limits = getPlanLimits(p);

  const max = limits.max_agency_bots;
  if (max == null) return { ok: true };

  const row = (await db.get(
    `
    SELECT COUNT(1) AS n
    FROM bots
    WHERE agency_id = ?
      AND owner_user_id IS NULL
    `,
    String(agencyId)
  )) as { n?: number } | undefined;

  const used = Number(row?.n ?? 0);

  if (used >= max) {
    return {
      ok: false,
      status: 403,
      body: {
        ok: false,
        error: "AGENCY_BOT_LIMIT_EXCEEDED",
        used,
        max,
        plan: p,
      },
    };
  }

  return { ok: true };
}