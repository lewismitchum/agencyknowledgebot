// lib/enforcement.ts
import type { Db } from "@/lib/db";
import { getPlanLimits, normalizePlan, requireFeature, type FeatureKey } from "@/lib/plans";
import { getUsageRow } from "@/lib/usage";

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
  dateKey: string,
  plan: unknown
): Promise<EnforcementResult> {
  const p = normalizePlan(plan);
  const limits = getPlanLimits(p);
  const usage = await getUsageRow(db, agencyId, dateKey);

  const limit = Number(limits.daily_messages ?? 0);
  if (limit > 0 && usage.messages_count >= limit) {
    return {
      ok: false,
      status: 429,
      body: {
        ok: false,
        error: "DAILY_LIMIT_EXCEEDED",
        used: usage.messages_count,
        daily_limit: limit,
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
  dateKey: string,
  plan: unknown,
  attemptedUploads: number
): Promise<EnforcementResult> {
  const p = normalizePlan(plan);
  const limits = getPlanLimits(p);

  if (limits.daily_uploads == null) return { ok: true };

  const limit = Number(limits.daily_uploads);
  if (!Number.isFinite(limit) || limit <= 0) return { ok: true };

  const usage = await getUsageRow(db, agencyId, dateKey);

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