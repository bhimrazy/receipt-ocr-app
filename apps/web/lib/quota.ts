import "server-only";
import {
  checkQuota,
  enforceQuota,
  nextUtcMidnight,
  personalPolicy,
  quotaLimits,
  workspacePlan,
  type UsageSubject,
} from "@receipt-ocr/core";
import { Effect } from "effect";
import { cache } from "react";
import type { Usage } from "@/components/usage-meter";
import { getCurrentPlan } from "./plan-limits";
import { runtime } from "./runtime";
import { requireActiveScope } from "./session";

/**
 * Effect for routes: fails with QuotaExceeded when the user, the workspace or
 * the service is out of room, before anything is stored. Reads the
 * workspace's plan fresh from the database, with the uploader's early-access
 * allowance applied (`accountCreatedAt`: the session user's); returns its id for
 * logs and the limits that ingest and retry enforce again under the quota lock.
 */
export const enforceUploadQuota = (subject: UsageSubject, accountCreatedAt: Date | string) =>
  Effect.flatMap(workspacePlan(subject.organizationId), ({ plan, policy }) => {
    const limits = quotaLimits(plan, personalPolicy(plan, policy, accountCreatedAt).policy);
    return enforceQuota(subject, limits).pipe(Effect.as({ plan, limits }));
  });

export type UsageSummary = Usage;

/**
 * The usage meter for the active workspace: the user's Free day, or the
 * workspace's Pro month. Deduplicated per request. Windows are UTC.
 */
export const getUsageSummary = cache(async (): Promise<UsageSummary> => {
  const scope = await requireActiveScope();
  const { plan, policy, earlyAccessUntil } = await getCurrentPlan();
  const verdict = await runtime.runPromise(checkQuota(scope, quotaLimits(plan, policy)));
  const window = verdict.allowed || verdict.window === "minute" ? null : (verdict.window ?? "day");
  const opensAt = window === "month" ? verdict.resetsAt : nextUtcMidnight(new Date());
  return {
    period: verdict.period,
    scope: verdict.scope,
    used: verdict.used,
    limit: verdict.limit,
    resetsAt: verdict.resetsAt,
    ...(verdict.day ? { day: verdict.day } : {}),
    blocked: window,
    opensAt: window === null ? verdict.resetsAt : opensAt,
    ...(earlyAccessUntil ? { earlyAccessUntil } : {}),
  };
});
