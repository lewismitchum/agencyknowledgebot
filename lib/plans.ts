// lib/plans.ts
export type PlanKey = "free" | "home" | "pro" | "enterprise" | "corporation";

export type FeatureKey =
  | "schedule"
  | "extraction"
  | "notifications"
  | "multimedia"
  | "spreadsheets"
  | "email";

/**
 * Normalize anything from DB/Stripe/UI into our canonical PlanKey.
 * Supports legacy names: home/personal -> home
 */
export function normalizePlan(input: unknown): PlanKey {
  const s = String(input ?? "")
    .trim()
    .toLowerCase();

  if (!s) return "free";

  // legacy aliases
  if (s === "home") return "home";
  if (s === "personal") return "home";
  if (s === "home") return "home";

  if (s === "free") return "free";
  if (s === "pro") return "pro";
  if (s === "enterprise") return "enterprise";
  if (s === "corp") return "corporation";
  if (s === "corporation") return "corporation";

  // Stripe price nicknames sometimes end up here; be conservative
  if (s.includes("enterprise")) return "enterprise";
  if (s.includes("corporation") || s.includes("corp")) return "corporation";
  if (s.includes("pro")) return "pro";
  if (s.includes("home") || s.includes("home") || s.includes("personal")) return "home";

  return "free";
}

export type PlanLimits = {
  // core limits (null => unlimited)
  daily_messages: number | null;
  daily_uploads: number | null;

  // seats & bots (null => unlimited)
  max_users: number | null; // billable seats (excludes owner/admin)
  max_agency_bots: number | null; // shared bots only (owner_user_id IS NULL)

  // features
  features: Record<FeatureKey, boolean>;
};

const PLANS: Record<PlanKey, PlanLimits> = {
  free: {
    daily_messages: 20,
    daily_uploads: 5,
    max_users: 0, // Free is intended as solo/eval; seat enforcement code counts non-owner/admin only.
    max_agency_bots: 1,
    features: {
      schedule: false,
      extraction: false,
      notifications: true, // notifications page exists for all tiers
      multimedia: false,
      spreadsheets: false,
      email: false,
    },
  },

  home: {
    // Home tier: everyday life + personal productivity (not “agency” positioned)
    daily_messages: 100,
    daily_uploads: null, // unlimited doc uploads
    max_users: 5,
    max_agency_bots: 1,
    features: {
      schedule: true,
      extraction: true,
      notifications: true,
      multimedia: false, // docs-only (keeps costs predictable)
      spreadsheets: false,
      email: false,
    },
  },

  pro: {
    daily_messages: null, // unlimited
    daily_uploads: null, // unlimited
    max_users: 15,
    max_agency_bots: 3,
    features: {
      schedule: true,
      extraction: true,
      notifications: true,
      multimedia: true, // docs + images + video
      spreadsheets: false, // paid feature later; keep corp-only for now
      email: false,
    },
  },

  enterprise: {
    daily_messages: null,
    daily_uploads: null,
    max_users: 50,
    max_agency_bots: 5,
    features: {
      schedule: true,
      extraction: true,
      notifications: true,
      multimedia: true,
      spreadsheets: false,
      email: false,
    },
  },

  corporation: {
    daily_messages: null,
    daily_uploads: null,
    max_users: 100,
    max_agency_bots: 10,
    features: {
      schedule: true,
      extraction: true,
      notifications: true,
      multimedia: true,
      spreadsheets: true, // “Spreadsheet AI” tier
      email: true, // Gmail-like inbox feature
    },
  },
};

export function getPlanLimits(plan: unknown): PlanLimits {
  return PLANS[normalizePlan(plan)];
}

export function hasFeature(plan: unknown, feature: FeatureKey): boolean {
  const p = normalizePlan(plan);
  return Boolean(PLANS[p]?.features?.[feature]);
}

/**
 * Used by API routes for server-side gating.
 */
export function requireFeature(plan: unknown, feature: FeatureKey) {
  const p = normalizePlan(plan);
  const ok = Boolean(PLANS[p]?.features?.[feature]);

  if (ok) return { ok: true as const };

  return {
    ok: false as const,
    status: 403,
    body: {
      ok: false,
      error: "FEATURE_NOT_AVAILABLE",
      feature,
      plan: p,
    },
  };
}