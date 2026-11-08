import { Effect } from "effect";
import { loadDailyOcrCap } from "./config";
import { QuotaExceeded } from "./errors";
import { DEFAULT_PLAN, type PlanId, type PlanPolicy, type QuotaScope } from "./plans";
import { ReceiptRepo, STALE_AFTER_MS, type QuotaGate } from "./repository";
import type { UsageCounts, UsageSubject, UsageWindow } from "./usage";

/**
 * The limits one upload is checked against, from its workspace's plan
 * (`quotaLimits`). `perDay` and `perMonth` count `scope`: the user, or the
 * workspace. Omitted fields (tests, older callers) mean Free, per user, no
 * monthly limit and no pool.
 */
export type QuotaLimits = {
  perMinute: number;
  perDay: number;
  perMonth?: number | null;
  scope?: QuotaScope;
  /** Rounds of this plan per UTC day across every user. */
  planPoolPerDay?: number | null;
  /** The allowance this upload draws from. */
  plan?: PlanId;
};

export const quotaLimits = (plan: PlanId, policy: PlanPolicy): QuotaLimits => ({
  plan,
  scope: policy.scope,
  perMinute: policy.receiptsPerMinute,
  perDay: policy.receiptsPerDay,
  perMonth: policy.receiptsPerMonth,
  planPoolPerDay: policy.poolPerDay,
});

export type QuotaWindowName = "minute" | "day" | "month" | "pool" | "global";

export type QuotaVerdict = {
  allowed: boolean;
  /** Which limit was hit, when `allowed` is false. */
  window?: QuotaWindowName;
  /** The meter's period: the month when the plan has a monthly limit, else the day. */
  period: "day" | "month";
  /** Whose usage the counts are: the user's or the workspace's. */
  scope: QuotaScope;
  /** The count and limit for `period`, for the usage meter. */
  used: number;
  limit: number;
  /** When `period` resets. */
  resetsAt: Date;
  /** With a monthly limit: today's count and limit as well. */
  day?: { used: number; limit: number };
  retryAfterSeconds?: number;
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** The daily window is the UTC calendar day: one reset time everyone can be told. */
export const utcDayStart = (now: Date) =>
  new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

export const nextUtcMidnight = (now: Date) => new Date(utcDayStart(now).getTime() + DAY_MS);

/** The monthly window is the UTC calendar month. */
export const utcMonthStart = (now: Date) =>
  new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

export const nextUtcMonthStart = (now: Date) =>
  new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));

const secondsUntil = (at: Date, now: Date) =>
  Math.max(1, Math.ceil((at.getTime() - now.getTime()) / 1000));

/**
 * Checked in this order, first refusal wins:
 * 1. the global fuse (`OCR_DAILY_CAP`, every plan, platform-wide);
 * 2. the plan's platform pool for today (Free: every Free user together);
 * 3. the month, for the plan's scope (Free: the user; Pro: the workspace);
 * 4. the day, for the same scope;
 * 5. the user's burst minute.
 */
export function decideQuota(
  counts: UsageCounts,
  limits: QuotaLimits,
  globalCap: number | undefined,
  now: Date,
): QuotaVerdict {
  const midnight = nextUtcMidnight(now);
  const untilMidnight = secondsUntil(midnight, now);
  const scope = limits.scope ?? "user";
  const perMonth = limits.perMonth ?? null;
  const base: QuotaVerdict =
    perMonth !== null
      ? {
          allowed: true,
          period: "month",
          scope,
          used: counts.month ?? 0,
          limit: perMonth,
          resetsAt: nextUtcMonthStart(now),
          day: { used: counts.day, limit: limits.perDay },
        }
      : {
          allowed: true,
          period: "day",
          scope,
          used: counts.day,
          limit: limits.perDay,
          resetsAt: midnight,
        };
  const blocked = (window: QuotaWindowName, retryAfterSeconds: number): QuotaVerdict => ({
    ...base,
    allowed: false,
    window,
    retryAfterSeconds,
  });

  if (globalCap !== undefined && (counts.globalDay ?? 0) >= globalCap) {
    return blocked("global", untilMidnight);
  }
  const pool = limits.planPoolPerDay ?? null;
  if (pool !== null && (counts.planDay ?? 0) >= pool) return blocked("pool", untilMidnight);
  if (perMonth !== null && (counts.month ?? 0) >= perMonth) {
    return blocked("month", secondsUntil(base.resetsAt, now));
  }
  if (counts.day >= limits.perDay) return blocked("day", untilMidnight);
  if (counts.userMinute >= limits.perMinute) return blocked("minute", 60);
  return base;
}

export const usageWindow = (
  now: Date,
  includeGlobal: boolean,
  limits: Pick<QuotaLimits, "plan" | "scope" | "perMonth" | "planPoolPerDay"> = {},
): UsageWindow => ({
  dayStart: utcDayStart(now),
  minuteStart: new Date(now.getTime() - 60_000),
  monthStart: (limits.perMonth ?? null) !== null ? utcMonthStart(now) : null,
  pendingSince: new Date(now.getTime() - STALE_AFTER_MS),
  plan: limits.plan ?? DEFAULT_PLAN,
  scope: limits.scope ?? "user",
  includePlanPool: (limits.planPoolPerDay ?? null) !== null,
  includeGlobal,
});

/** The check `ReceiptRepo.insert` / `claimRetry` run under the quota lock. */
export const quotaGate = (limits: QuotaLimits, now = new Date()) =>
  Effect.map(loadDailyOcrCap, (globalCap): QuotaGate => ({
    window: usageWindow(now, globalCap !== undefined, limits),
    decide: (counts) => decideQuota(counts, limits, globalCap, now),
  }));

/** Read-only check, for the usage meter and to refuse early before storing a file. */
export const checkQuota = (subject: UsageSubject, limits: QuotaLimits, now = new Date()) =>
  Effect.gen(function* () {
    const repo = yield* ReceiptRepo;
    const gate = yield* quotaGate(limits, now);
    return gate.decide(yield* repo.usage(subject, gate.window));
  });

export const quotaExceeded = (verdict: QuotaVerdict) =>
  new QuotaExceeded({
    message: quotaMessage(verdict),
    retryAfterSeconds: verdict.retryAfterSeconds ?? 60,
    kind: verdict.window,
  });

const scans = (n: number) => `${n} ${n === 1 ? "scan" : "scans"}`;

const monthDay = (date: Date) =>
  date.toLocaleDateString("en-GB", { day: "numeric", month: "long", timeZone: "UTC" });

/** What a refused upload is told: which limit, when it resets, and where more room is. */
export function quotaMessage(verdict: QuotaVerdict): string {
  const reset = `They reset on ${monthDay(verdict.resetsAt)} at 00:00 UTC.`;
  const workspace = verdict.scope === "workspace";
  switch (verdict.window) {
    case "minute":
      return "Too many uploads at once. Wait a minute and try again.";
    case "global":
      return "Receipt reading is at capacity for today. Try again after 00:00 UTC.";
    case "pool":
      return "Free scanning is busy today: the Free plan's shared daily capacity is used up. Try again after 00:00 UTC, or upgrade this workspace to Pro.";
    case "month":
      return workspace
        ? `This workspace has used all ${scans(verdict.limit)} for this month. ${reset}`
        : `You've used all ${scans(verdict.limit)} on the Free plan this month. ${reset} Upgrade a workspace to Pro for more scans.`;
    default: {
      const day = verdict.day?.limit ?? verdict.limit;
      if (workspace) {
        const left = Math.max(0, verdict.limit - verdict.used);
        return `This workspace has used its ${scans(day)} for today. Uploads open at 00:00 UTC; ${left} of ${scans(verdict.limit)} are left this month.`;
      }
      return `You've used all ${scans(day)} for today. You can upload again at 00:00 UTC.`;
    }
  }
}

/** Fails with QuotaExceeded when the user, the workspace or the service is out of room. */
export const enforceQuota = (subject: UsageSubject, limits: QuotaLimits) =>
  Effect.flatMap(checkQuota(subject, limits), (verdict) =>
    verdict.allowed ? Effect.succeed(verdict) : Effect.fail(quotaExceeded(verdict)),
  );
