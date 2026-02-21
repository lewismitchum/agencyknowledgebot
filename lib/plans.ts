// lib/plans.ts

export type PlanKey = "free" | "starter" | "pro" | "enterprise" | "corporation";

export type PlanLimits = {
  daily_messages: number;
  daily_uploads: number | null;
  max_users: number | null; // billable members only (exclude owner/admin)
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
    daily_messages: 500, // your spec
    daily_uploads: null, // unlimited docs
    max_users: 5,
    max_agency_bots: 1,
    allow_images: false,
    allow_video: false,
  },
  pro: {
    daily_messages: 999999, // unlimited chats (enforced by other rate limiting)
    daily_uploads: null,
    max_users: 15,
    max_agency_bots: 3,
    allow_images: true,
    allow_video: true, // spec allows video
  },
  enterprise: {
    daily_messages: 999999,
    daily_uploads: null,
    max_users: 50,
    max_agency_bots: 5,
    allow_images: true,
    allow_video: true,
  },
  corporation: {
    daily_messages: 999999,
    daily_uploads: null,
    max_users: 100,
    max_agency_bots: 10,
    allow_images: true,
    allow_video: true,
  },
};

export function normalizePlan(plan: unknown): PlanKey {
  const p = String(plan || "").toLowerCase().trim();
  if (p === "starter" || p === "pro" || p === "enterprise" || p === "corporation") return p;
  return "free";
}

export function getPlanLimits(plan: unknown): PlanLimits {
  return LIMITS[normalizePlan(plan)];
}

export function isPaidPlan(plan: string | null) {
  return normalizePlan(plan) !== "free";
}

export type FeatureKey = "schedule" | "extraction" | "multimedia" | "email" | "spreadsheets";

const FEATURES: Record<FeatureKey, PlanKey[]> = {
  schedule: ["starter", "pro", "enterprise", "corporation"],
  extraction: ["starter", "pro", "enterprise", "corporation"],
  multimedia: ["pro", "enterprise", "corporation"],
  email: ["corporation"],
  spreadsheets: ["corporation"],
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