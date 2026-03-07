export type PlanKey = "free" | "home" | "pro" | "enterprise" | "corporation";

export type FeatureKey =
  | "schedule"
  | "extraction"
  | "notifications"
  | "multimedia"
  | "spreadsheets"
  | "email";

export type PlanLimits = {
  daily_messages: number | null;
  daily_uploads: number | null;
  max_users: number | null;
  max_agency_bots: number | null;
  features: Record<FeatureKey, boolean>;
};

export type PlanDefinition = {
  key: PlanKey;
  active: boolean;
  limits: PlanLimits;
};

/**
 * Normalize anything from DB/Stripe/UI into our canonical PlanKey.
 * Supports legacy names.
 */
export function normalizePlan(input: unknown): PlanKey {
  const s = String(input ?? "").trim().toLowerCase();

  if (!s) return "free";

  if (s === "free") return "free";
  if (s === "home") return "home";
  if (s === "personal") return "home";
  if (s === "pro") return "pro";
  if (s === "enterprise") return "enterprise";
  if (s === "corp") return "corporation";
  if (s === "corporation") return "corporation";

  if (s.includes("enterprise")) return "enterprise";
  if (s.includes("corporation") || s.includes("corp")) return "corporation";
  if (s.includes("pro")) return "pro";
  if (s.includes("home") || s.includes("personal")) return "home";

  return "free";
}

const PLAN_DEFS: Record<PlanKey, PlanDefinition> = {
  free: {
    key: "free",
    active: true,
    limits: {
      daily_messages: 20,
      daily_uploads: 5,
      max_users: 0,
      max_agency_bots: 1,
      features: {
        schedule: false,
        extraction: false,
        notifications: true,
        multimedia: false,
        spreadsheets: false,
        email: false,
      },
    },
  },

  home: {
    key: "home",
    active: true,
    limits: {
      daily_messages: 100,
      daily_uploads: null,
      max_users: 5,
      max_agency_bots: 1,
      features: {
        schedule: true,
        extraction: true,
        notifications: true,
        multimedia: false,
        spreadsheets: false,
        email: false,
      },
    },
  },

  pro: {
    key: "pro",
    active: true,
    limits: {
      daily_messages: null,
      daily_uploads: null,
      max_users: 15,
      max_agency_bots: 3,
      features: {
        schedule: true,
        extraction: true,
        notifications: true,
        multimedia: true,
        spreadsheets: false,
        email: false,
      },
    },
  },

  enterprise: {
    key: "enterprise",
    active: true,
    limits: {
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
  },

  corporation: {
    key: "corporation",
    active: true,
    limits: {
      daily_messages: null,
      daily_uploads: null,
      max_users: 100,
      max_agency_bots: 10,
      features: {
        schedule: true,
        extraction: true,
        notifications: true,
        multimedia: true,
        spreadsheets: true,
        email: true,
      },
    },
  },
};

export function getPlanLimits(plan: unknown): PlanLimits {
  return PLAN_DEFS[normalizePlan(plan)].limits;
}

export function hasFeature(plan: unknown, feature: FeatureKey): boolean {
  const p = normalizePlan(plan);
  return Boolean(PLAN_DEFS[p]?.limits?.features?.[feature]);
}

export function isPlanActive(plan: unknown): boolean {
  const p = normalizePlan(plan);
  return Boolean(PLAN_DEFS[p]?.active);
}

export function getPlanDefinition(plan: unknown): PlanDefinition {
  return PLAN_DEFS[normalizePlan(plan)];
}

export function getAllPlanDefinitions(): PlanDefinition[] {
  return (Object.keys(PLAN_DEFS) as PlanKey[]).map((key) => PLAN_DEFS[key]);
}

export function getActivePlanDefinitions(): PlanDefinition[] {
  return getAllPlanDefinitions().filter((p) => p.active);
}

export function getActivePlanKeys(): PlanKey[] {
  return getActivePlanDefinitions().map((p) => p.key);
}

export function getPurchasablePlanDefinitions(): PlanDefinition[] {
  return getActivePlanDefinitions().filter((p) => p.key !== "free");
}

export function getPurchasablePlanKeys(): PlanKey[] {
  return getPurchasablePlanDefinitions().map((p) => p.key);
}

export function setPlanActiveForCode(plan: PlanKey, active: boolean) {
  if (!PLAN_DEFS[plan]) return;
  PLAN_DEFS[plan] = {
    ...PLAN_DEFS[plan],
    active,
  };
}

/**
 * Used by API routes for server-side gating.
 */
export function requireFeature(plan: unknown, feature: FeatureKey) {
  const p = normalizePlan(plan);
  const ok = Boolean(PLAN_DEFS[p]?.limits?.features?.[feature]);

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