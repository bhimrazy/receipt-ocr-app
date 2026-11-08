import { eq, user } from "@receipt-ocr/db";
import { Effect } from "effect";
import { loadDailyOcrCap } from "./config";
import { QuotaExceeded } from "./errors";
import { DEFAULT_PLAN, isPlanId, policyFor, type PlanId, type PlanPolicy } from "./plans";
import { ReceiptRepo, STALE_AFTER_MS, type QuotaGate } from "./repository";
import { Db } from "./services";
import { Settings } from "./settings";
import type { UsageCounts, UsageWindow } from "./usage";

export type QuotaLimits = { perMinute: number; perDay: number };

export const quotaLimits = (policy: PlanPolicy): QuotaLimits => ({
  perMinute: policy.receiptsPerMinute,
  perDay: policy.receiptsPerDay,
});

/**
 * The user's plan read from the database, with the limits an admin has set
 * for it. Not from the session: its cookie cache would delay a plan change
 * by up to five minutes.
 */
export const userPlan = (userId: string) =>
  Effect.gen(function* () {
    const { use } = yield* Db;
    const settings = yield* Settings;
    const [rows, plans] = yield* Effect.all(
      [
        use((db) => db.select({ plan: user.plan }).from(user).where(eq(user.id, userId)).limit(1)),
        settings.plans,
      ],
      { concurrency: "unbounded" },
    );
    const stored = rows[0]?.plan;
    const plan: PlanId = isPlanId(stored) ? stored : DEFAULT_PLAN;
    return { plan, policy: policyFor(plans, plan) };
  });

export type QuotaVerdict = {
  allowed: boolean;
  /** Which limit was hit, when `allowed` is false. */
  window?: "minute" | "day" | "global";
  /** The user's own count and limit for today, for the usage meter. */
  used: number;
  limit: number;
  resetsAt: Date;
  retryAfterSeconds?: number;
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** The daily window is the UTC calendar day: one reset time everyone can be told. */
export const utcDayStart = (now: Date) =>
  new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

export const nextUtcMidnight = (now: Date) => new Date(utcDayStart(now).getTime() + DAY_MS);

export function decideQuota(
  counts: UsageCounts,
  limits: QuotaLimits,
  globalCap: number | undefined,
  now: Date,
): QuotaVerdict {
  const resetsAt = nextUtcMidnight(now);
  const untilReset = Math.max(1, Math.ceil((resetsAt.getTime() - now.getTime()) / 1000));
  const base = { used: counts.userDay, limit: limits.perDay, resetsAt };
  if (globalCap !== undefined && (counts.globalDay ?? 0) >= globalCap) {
    return { ...base, allowed: false, window: "global", retryAfterSeconds: untilReset };
  }
  if (counts.userDay >= limits.perDay) {
    return { ...base, allowed: false, window: "day", retryAfterSeconds: untilReset };
  }
  if (counts.userMinute >= limits.perMinute) {
    return { ...base, allowed: false, window: "minute", retryAfterSeconds: 60 };
  }
  return { ...base, allowed: true };
}

export const usageWindow = (now: Date, includeGlobal: boolean): UsageWindow => ({
  dayStart: utcDayStart(now),
  minuteStart: new Date(now.getTime() - 60_000),
  pendingSince: new Date(now.getTime() - STALE_AFTER_MS),
  includeGlobal,
});

/** The check `ReceiptRepo.insert` / `claimRetry` run under the user's lock. */
export const quotaGate = (limits: QuotaLimits, now = new Date()) =>
  Effect.map(loadDailyOcrCap, (globalCap): QuotaGate => ({
    window: usageWindow(now, globalCap !== undefined),
    decide: (counts) => decideQuota(counts, limits, globalCap, now),
  }));

/** Read-only check, for the usage meter and to refuse early before storing a file. */
export const checkQuota = (userId: string, limits: QuotaLimits, now = new Date()) =>
  Effect.gen(function* () {
    const repo = yield* ReceiptRepo;
    const gate = yield* quotaGate(limits, now);
    return gate.decide(yield* repo.usage(userId, gate.window));
  });

export const quotaExceeded = (verdict: QuotaVerdict) =>
  new QuotaExceeded({
    message: quotaMessage(verdict),
    retryAfterSeconds: verdict.retryAfterSeconds ?? 60,
    kind: verdict.window,
  });

export function quotaMessage(verdict: QuotaVerdict): string {
  switch (verdict.window) {
    case "minute":
      return "Too many uploads at once. Wait a minute and try again.";
    case "global":
      return "Receipt reading is at capacity for today. Try again after 00:00 UTC.";
    default:
      return `You've used all ${verdict.limit} ${verdict.limit === 1 ? "receipt" : "receipts"} for today. You can upload again after 00:00 UTC.`;
  }
}

/** Fails with QuotaExceeded when the user (or the whole service) is out of room. */
export const enforceQuota = (userId: string, limits: QuotaLimits) =>
  Effect.flatMap(checkQuota(userId, limits), (verdict) =>
    verdict.allowed ? Effect.succeed(verdict) : Effect.fail(quotaExceeded(verdict)),
  );
