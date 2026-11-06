/**
 * Plan limit defaults and their shape. Imports nothing so client components
 * (marketing copy, the sign-up subtitle) can read the defaults without pulling
 * in Effect or the database. Runtime values come from the `Settings` service,
 * which falls back to these when no admin override is saved.
 */

export interface PlanPolicy {
  /** Workspaces a user may own. */
  workspaces: number;
  /** Receipts per UTC calendar day. */
  receiptsPerDay: number;
  /** Burst ceiling per rolling minute. */
  receiptsPerMinute: number;
  /** Images in one upload batch (camera tray plus picked files). A client-side cap; the limits above still apply per upload. */
  batchMax: number;
}

/**
 * Failed reads per user per UTC day that don't count toward the daily limit.
 * Past this, each failed round counts like a receipt: every one is a paid
 * model call, so endless junk uploads can't run up cost for free.
 */
export const FREE_FAILED_ROUNDS = 5;

export const PLAN_IDS = ["free", "pro"] as const;
export type PlanId = (typeof PLAN_IDS)[number];
export type PlanTable = Record<PlanId, PlanPolicy>;

export const DEFAULT_PLAN: PlanId = "free";

export const DEFAULT_BATCH_MAX = 10;

export const DEFAULT_PLANS: PlanTable = {
  free: { workspaces: 1, receiptsPerDay: 20, receiptsPerMinute: 10, batchMax: DEFAULT_BATCH_MAX },
  pro: { workspaces: 5, receiptsPerDay: 1000, receiptsPerMinute: 30, batchMax: DEFAULT_BATCH_MAX },
};

export function isPlanId(value: unknown): value is PlanId {
  return typeof value === "string" && (PLAN_IDS as readonly string[]).includes(value);
}

/** Unknown or missing plans get the default plan's limits, never unlimited. */
export function policyFor(plans: PlanTable, plan: string | null | undefined): PlanPolicy {
  return isPlanId(plan) ? plans[plan] : plans[DEFAULT_PLAN];
}
