// lib/plan-gating.ts

import { normalizePlan } from "@/lib/plans";

export type PlanId = "free" | "starter" | "pro" | "team" | "enterprise";

/**
 * Single source of truth for "paid feature" gating.
 * - Free: docs/chat only
 * - Paid (starter+): unlock schedule/calendar/to-do extraction
 */
export function isPaidPlan(plan: string | null | undefined): boolean {
  const p = normalizePlan(plan) as PlanId;
  return p !== "free";
}

/**
 * Schedule/Calendar/To-do features should ONLY exist on paid plans.
 */
export function canUseSchedule(plan: string | null | undefined): boolean {
  return isPaidPlan(plan);
}

/**
 * Multimedia uploads (images/video) should be limited to higher tiers later.
 * For now, keep it conservative: only team+.
 * Tune this when you implement real multimedia ingestion.
 */
export function canUploadMedia(plan: string | null | undefined): boolean {
  const p = normalizePlan(plan) as PlanId;
  return p === "team" || p === "enterprise";
}

/**
 * Docs uploads should be allowed on all tiers (including free).
 */
export function canUploadDocs(plan: string | null | undefined): boolean {
  return true;
}
