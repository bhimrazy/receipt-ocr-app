/**
 * Plan names and the code defaults, safe for client components: the only
 * import is the import-free `@receipt-ocr/core/plans`. The limits users see
 * and get come from `getPlanTable()` / `getCurrentPlan()` in plan-limits.ts,
 * which apply what an admin saved.
 */
export {
  DEFAULT_PLAN,
  DEFAULT_PLANS,
  policyFor,
  type PlanId,
  type PlanPolicy,
  type PlanTable,
} from "@receipt-ocr/core/plans";

/** "Free plan", "Pro plan". */
export function planLabel(plan: string): string {
  return `${plan.charAt(0).toUpperCase()}${plan.slice(1)} plan`;
}
