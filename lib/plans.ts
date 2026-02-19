// lib/plans.ts

export type PlanKey = "free" | "starter" | "pro" | "enterprise";

export type PlanLimits = {
  daily_messages: number;
  daily_uploads: number | null;
  max_users: number | null; // billable members only
  max_agency_bots: number | null;
  allow_images: boolean;
  allow_video: boolean;
};

const LIMITS: Record<PlanKey, PlanLimits> = {
  free: {
    daily_messages: 20,
    daily_uploads: 5,
    max_users: 1,
    max_agency_bots: 1,
    allow_images: false,
    allow_video: false,
  },
  starter: {
    daily_messages: 200,
    daily_uploads: null,
    max_users: 5,
    max_agency_bots: 1,
    allow_images: false,
    allow_video: false,
  },
  pro: {
    daily_messages: 500,
    daily_uploads: null,
    max_users: 15,
    max_agency_bots: 3,
    allow_images: true,
    allow_video: false,
  },
  enterprise: {
    daily_messages: 2000,
    daily_uploads: null,
    max_users: 50,
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
  return normalizePlan(plan) !== "free";
}

export type FeatureKey = "schedule" | "extraction" | "multimedia";

const FEATURES: Record<FeatureKey, PlanKey[]> = {
  schedule: ["starter", "pro", "enterprise"],
  extraction: ["starter", "pro", "enterprise"],
  multimedia: ["pro", "enterprise"],
};

export function hasFeature(plan: unknown, feature: FeatureKey): boolean {
  return FEATURES[feature].includes(normalizePlan(plan));
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
