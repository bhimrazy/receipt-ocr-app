import "server-only";
import { checkQuota, enforceQuota, nextUtcMidnight, type QuotaLimits } from "@receipt-ocr/core";
import { planPolicy } from "./plans";
import { runtime } from "./runtime";
import { getSession, planFor } from "./session";

export function quotaLimitsFor(plan: string | undefined): QuotaLimits {
  const policy = planPolicy(plan);
  return { perMinute: policy.receiptsPerMinute, perDay: policy.receiptsPerDay };
}

/** Effect for routes: fails with QuotaExceeded when the user or the service is out of room. */
export const enforceUploadQuota = (userId: string, plan: string | undefined) =>
  enforceQuota(userId, quotaLimitsFor(plan));

export type UsageSummary = { used: number; limit: number; window: "day"; resetsAt: Date };

/**
 * Today's receipts for the current user, for the usage meter. Failed
 * receipts don't count. The window is the UTC day.
 */
export async function getUsageSummary(): Promise<UsageSummary> {
  const session = await getSession();
  const limits = quotaLimitsFor(planFor(session));
  if (!session) {
    return { used: 0, limit: limits.perDay, window: "day", resetsAt: nextUtcMidnight(new Date()) };
  }
  const verdict = await runtime.runPromise(checkQuota(session.user.id, limits));
  return { used: verdict.used, limit: verdict.limit, window: "day", resetsAt: verdict.resetsAt };
}
