import "server-only";
import { checkQuota, enforceQuota, type QuotaLimits } from "@receipt-ocr/core";
import { planPolicy } from "./plans";
import { runtime } from "./runtime";
import { planFor, requireSession } from "./session";

export function quotaLimitsFor(plan: string | undefined): QuotaLimits {
  const policy = planPolicy(plan);
  return { perMinute: policy.receiptsPerMinute, perDay: policy.receiptsPerDay };
}

/** Effect for routes: fails with QuotaExceeded when the user or the service is out of room. */
export const enforceUploadQuota = (userId: string, plan: string | undefined) =>
  enforceQuota(userId, quotaLimitsFor(plan));

export type UsageSummary = {
  used: number;
  limit: number;
  window: "day";
  resetsAt: Date;
  /**
   * Why uploads are refused right now: the user's own daily limit, or the
   * service-wide daily cap. The per-minute burst limit clears itself, so it
   * isn't reported here.
   */
  blocked: "day" | "global" | null;
};

/**
 * Today's receipts for the signed-in user, for the usage meter. Failed
 * receipts don't count. The window is the UTC day.
 */
export async function getUsageSummary(): Promise<UsageSummary> {
  const session = await requireSession();
  const verdict = await runtime.runPromise(
    checkQuota(session.user.id, quotaLimitsFor(planFor(session))),
  );
  const blocked = verdict.allowed || verdict.window === "minute" ? null : (verdict.window ?? "day");
  return {
    used: verdict.used,
    limit: verdict.limit,
    window: "day",
    resetsAt: verdict.resetsAt,
    blocked,
  };
}
