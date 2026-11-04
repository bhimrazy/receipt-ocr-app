/**
 * Plan policy in one place. This module deliberately imports nothing: both
 * `lib/auth.ts` (which enforces the workspace cap) and the UI read from it, so
 * it must stay free of the auth/session import cycle.
 */

export interface PlanPolicy {
  /** Workspaces a user may own. */
  workspaces: number;
  /** Receipts per rolling 24 hours. */
  receiptsPerDay: number;
  /** Burst ceiling per rolling minute. */
  receiptsPerMinute: number;
}

export const PLANS: Record<string, PlanPolicy> = {
  free: { workspaces: 1, receiptsPerDay: 50, receiptsPerMinute: 10 },
  pro: { workspaces: 5, receiptsPerDay: 1000, receiptsPerMinute: 30 },
};

export const DEFAULT_PLAN = "free";

export function planPolicy(plan: string | undefined): PlanPolicy {
  return PLANS[plan ?? DEFAULT_PLAN] ?? PLANS[DEFAULT_PLAN];
}

export function workspaceLimitForPlan(plan: string | undefined): number {
  return planPolicy(plan).workspaces;
}

/** "Free plan", "Pro plan". */
export function planLabel(plan: string): string {
  return `${plan.charAt(0).toUpperCase()}${plan.slice(1)} plan`;
}
