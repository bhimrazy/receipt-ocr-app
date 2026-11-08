/**
 * The one source of plan limits: their shape and code defaults. Every limit a
 * user sees or hits reads from here, through the `Settings` service (which
 * applies what an admin saved in Admin → Settings and falls back to these).
 * Imports nothing, so client components (marketing copy, the sign-up subtitle)
 * can read the defaults without pulling in Effect or the database. The full
 * table, with how each limit is counted, is in docs/architecture/flows/billing.md.
 */

export const QUOTA_SCOPES = ["user", "workspace"] as const;
/** Who a plan's day and month limits count: each person, or the workspace's members together. */
export type QuotaScope = (typeof QUOTA_SCOPES)[number];

/**
 * Flat so the stored settings JSON and the admin audit diff stay one level
 * deep; grouped below by what each limit is for.
 */
export interface PlanPolicy {
  // Scans: the allowance, counted for `scope` in UTC calendar windows.
  /** `user`: each person, across every workspace on this plan (Free). `workspace`: shared by its members (Pro). */
  scope: QuotaScope;
  /** Scans per UTC day, for `scope`. */
  receiptsPerDay: number;
  /** Scans per UTC calendar month, for `scope`; null = no monthly limit. */
  receiptsPerMonth: number | null;

  // Platform: spend guards across everyone on the plan.
  /** Scans per UTC day across every user on this plan together; null = none. */
  poolPerDay: number | null;

  // Abuse and device limits, per user.
  /** Burst ceiling per user per rolling minute. */
  receiptsPerMinute: number;
  /** Images in one upload batch (camera tray plus picked files). A client-side cap; the limits above still apply per upload. */
  batchMax: number;

  // Account.
  /** Workspaces a user on this account plan may own. */
  workspaces: number;
}

/**
 * Failed reads per window (day or month) that don't count toward its limit.
 * Past this, each failed round counts like a receipt: every one is a paid
 * model call, so endless junk uploads can't run up cost for free.
 */
export const FREE_FAILED_ROUNDS = 5;

export const PLAN_IDS = ["free", "pro"] as const;
export type PlanId = (typeof PLAN_IDS)[number];
export type PlanTable = Record<PlanId, PlanPolicy>;

export const DEFAULT_PLAN: PlanId = "free";

export const DEFAULT_BATCH_MAX = 10;
/**
 * The most an admin can allow in one batch. Every photo is decoded, edited and encoded on the
 * phone before upload, and a bigger batch holds more full-size captures in memory at once.
 */
export const MAX_BATCH = 20;

export const DEFAULT_PLANS: PlanTable = {
  // Per person across all their workspaces: 20 a day, 100 a month (below Pro's 500), and
  // 300 a day for every Free user together.
  free: {
    scope: "user",
    receiptsPerDay: 20,
    receiptsPerMonth: 100,
    poolPerDay: 300,
    receiptsPerMinute: 10,
    batchMax: DEFAULT_BATCH_MAX,
    workspaces: 1,
  },
  // Per workspace, shared by its members: 500 a month, up to 200 a day.
  pro: {
    scope: "workspace",
    receiptsPerDay: 200,
    receiptsPerMonth: 500,
    poolPerDay: null,
    receiptsPerMinute: 30,
    batchMax: DEFAULT_BATCH_MAX,
    workspaces: 2,
  },
};

export function isPlanId(value: unknown): value is PlanId {
  return typeof value === "string" && (PLAN_IDS as readonly string[]).includes(value);
}

/** Unknown or missing plans get the default plan's limits, never unlimited. */
export function policyFor(plans: PlanTable, plan: string | null | undefined): PlanPolicy {
  return isPlanId(plan) ? plans[plan] : plans[DEFAULT_PLAN];
}
