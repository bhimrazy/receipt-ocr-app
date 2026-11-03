import { Effect } from "effect";
import { loadDailyOcrCap } from "./config";
import { QuotaExceeded } from "./errors";
import { ReceiptRepo, type UsageCounts } from "./repository";

export type QuotaLimits = { perMinute: number; perDay: number };

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

export const checkQuota = (userId: string, limits: QuotaLimits, now = new Date()) =>
  Effect.gen(function* () {
    const repo = yield* ReceiptRepo;
    const globalCap = yield* loadDailyOcrCap;
    const counts = yield* repo.usage({
      userId,
      dayStart: utcDayStart(now),
      minuteStart: new Date(now.getTime() - 60_000),
      includeGlobal: globalCap !== undefined,
    });
    return decideQuota(counts, limits, globalCap, now);
  });

export function quotaMessage(verdict: QuotaVerdict): string {
  switch (verdict.window) {
    case "minute":
      return "Too many uploads at once. Wait a minute and try again.";
    case "global":
      return "Receipt reading is at capacity for today. Try again after 00:00 UTC.";
    default:
      return `You've used all ${verdict.limit} receipts for today. You can upload again after 00:00 UTC.`;
  }
}

/** Fails with QuotaExceeded when the user (or the whole service) is out of room. */
export const enforceQuota = (userId: string, limits: QuotaLimits) =>
  Effect.flatMap(checkQuota(userId, limits), (verdict) =>
    verdict.allowed
      ? Effect.succeed(verdict)
      : Effect.fail(
          new QuotaExceeded({
            message: quotaMessage(verdict),
            retryAfterSeconds: verdict.retryAfterSeconds ?? 60,
          }),
        ),
  );
