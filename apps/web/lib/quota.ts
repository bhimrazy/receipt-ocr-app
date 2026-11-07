import "server-only";
import { checkQuota, enforceQuota, quotaLimits, userPlan } from "@receipt-ocr/core";
import { Effect } from "effect";
import { cache } from "react";
import { getCurrentPlan } from "./plan-limits";
import { runtime } from "./runtime";
import { requireSession } from "./session";

/**
 * Effect for routes: fails with QuotaExceeded when the user or the service is
 * out of room, before anything is stored. Scans the plan fresh from the
 * database; returns its id for logs and the limits that ingest and retry
 * enforce again under the user's lock.
 */
export const enforceUploadQuota = (userId: string) =>
  Effect.flatMap(userPlan(userId), ({ plan, policy }) => {
    const limits = quotaLimits(policy);
    return enforceQuota(userId, limits).pipe(Effect.as({ plan, limits }));
  });

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
 * Today's receipts for the signed-in user, for the usage meter. Deduplicated per request. Failed
 * receipts don't count. The window is the UTC day.
 */
export const getUsageSummary = cache(async (): Promise<UsageSummary> => {
  const session = await requireSession();
  const { policy } = await getCurrentPlan();
  const verdict = await runtime.runPromise(checkQuota(session.user.id, quotaLimits(policy)));
  const blocked = verdict.allowed || verdict.window === "minute" ? null : (verdict.window ?? "day");
  return {
    used: verdict.used,
    limit: verdict.limit,
    window: "day",
    resetsAt: verdict.resetsAt,
    blocked,
  };
});
