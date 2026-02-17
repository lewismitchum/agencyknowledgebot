// lib/plans.ts

export type PlanKey = "free" | "starter" | "pro" | "enterprise";

export type PlanLimits = {
  // core
  daily_messages: number;

  // ✅ uploads/day (null => unlimited)
  daily_uploads: number | null;

  // ✅ seats (billable members) (null => unlimited)
  max_users: number | null;

  // ✅ agency bots allowed (owner_user_id IS NULL) (null => unlimited)
  max_agency_bots: number | null;

  // ✅ future-proofing (used for UI toggles + server gates)
  allow_images: boolean;
  allow_video: boolean;
};

const LIMITS: Record<PlanKey, PlanLimits> = {
  free: {
    daily_messages: 20,
    daily_uploads: 5,
    max_users: 1, // billable members only (owner/admin excluded)
    max_agency_bots: 1,
    allow_images: false,
    allow_video: false,
  },
  starter: {
    daily_messages: 200,
    daily_uploads: null, // unlimited
    max_users: 10,
    max_agency_bots: 1,
    allow_images: false,
    allow_video: false,
  },
  pro: {
    daily_messages: 500,
    daily_uploads: null, // unlimited
    max_users: 25,
    max_agency_bots: 3,
    allow_images: true,
    allow_video: false,
  },
  enterprise: {
    daily_messages: 2000,
    daily_uploads: null, // unlimited
    max_users: 100,
    max_agency_bots: 5,
    allow_images: true,
    allow_video: true,
  },
};

export function normalizePlan(plan: unknown): PlanKey {
  const p = String(plan || "").toLowerCase().trim();
  if (p === "starter" || p === "pro" || p === "enterprise") return p;
  return "free";
}

export function getPlanLimits(plan: unknown): PlanLimits {
  return LIMITS[normalizePlan(plan)];
}

export function isPaidPlan(plan: string | null) {
  const p = String(plan ?? "free").toLowerCase();
  return p !== "free";
}

/**
 * Feature gates (SERVER-SIDE).
 * Treat these as the canonical authority for entitlement checks.
 */
export type FeatureKey = "schedule" | "extraction" | "multimedia";

const FEATURES: Record<FeatureKey, PlanKey[]> = {
  schedule: ["starter", "pro", "enterprise"],
  extraction: ["starter", "pro", "enterprise"],
  multimedia: ["pro", "enterprise"],
};

export function hasFeature(plan: unknown, feature: FeatureKey): boolean {
  const p = normalizePlan(plan);
  return FEATURES[feature].includes(p);
}

export function requireFeature(
  plan: unknown,
  feature: FeatureKey
): { ok: true } | { ok: false; status: 403; body: any } {
  const p = normalizePlan(plan);
  if (FEATURES[feature].includes(p)) return { ok: true };

  return {
    ok: false,
    status: 403,
    body: {
      error: "Upgrade required",
      code: "PLAN_REQUIRED",
      feature,
      plan: p,
    },
  };
}
