import { Cause, Effect, Exit, Logger, LogLevel } from "effect";
import { describe, expect, it } from "vitest";
import { DEFAULT_PLANS } from "./plans";
import {
  decideQuota,
  nextUtcMidnight,
  nextUtcMonthStart,
  quotaLimits,
  quotaMessage,
  refuseQuota,
  usageWindow,
  utcDayStart,
  utcMonthStart,
  type QuotaVerdict,
} from "./quota";
import type { UsageCounts } from "./usage";

const limits = { perMinute: 10, perDay: 50 };
const now = new Date("2026-11-04T18:30:00Z");
const free = quotaLimits("free", DEFAULT_PLANS.free);
const pro = quotaLimits("pro", DEFAULT_PLANS.pro);
const untilMidnight = 5.5 * 3600;
const untilDecember = (new Date("2026-12-01T00:00:00Z").getTime() - now.getTime()) / 1000;

const counts = (fields: Partial<UsageCounts>): UsageCounts => ({
  userMinute: 0,
  day: 0,
  month: null,
  planDay: null,
  globalDay: null,
  ...fields,
});

describe("usage windows", () => {
  it("are the UTC calendar day and month", () => {
    expect(utcDayStart(now).toISOString()).toBe("2026-11-04T00:00:00.000Z");
    expect(nextUtcMidnight(now).toISOString()).toBe("2026-11-05T00:00:00.000Z");
    expect(nextUtcMidnight(new Date("2026-12-31T23:59:59Z")).toISOString()).toBe(
      "2027-01-01T00:00:00.000Z",
    );
    expect(utcMonthStart(now).toISOString()).toBe("2026-11-01T00:00:00.000Z");
    expect(nextUtcMonthStart(now).toISOString()).toBe("2026-12-01T00:00:00.000Z");
    expect(nextUtcMonthStart(new Date("2026-12-31T23:59:59.999Z")).toISOString()).toBe(
      "2027-01-01T00:00:00.000Z",
    );
  });

  it("roll over at 00:00 UTC whatever the local offset", () => {
    // 23:59:59.999 on the 30th is still November; one millisecond later is December.
    const last = new Date("2026-11-30T23:59:59.999Z");
    const first = new Date("2026-12-01T00:00:00.000Z");
    expect(utcMonthStart(last).toISOString()).toBe("2026-11-01T00:00:00.000Z");
    expect(utcMonthStart(first).toISOString()).toBe("2026-12-01T00:00:00.000Z");
    expect(utcDayStart(first).toISOString()).toBe("2026-12-01T00:00:00.000Z");
    // 01:00 on 1 December in UTC+05:45 (Kathmandu) is still 30 November in UTC.
    expect(utcMonthStart(new Date("2026-12-01T01:00:00+05:45")).toISOString()).toBe(
      "2026-11-01T00:00:00.000Z",
    );
  });

  it("count Free per user and Pro per workspace, each with a month, and the pool only on Free", () => {
    expect(usageWindow(now, false, free)).toMatchObject({
      plan: "free",
      scope: "user",
      monthStart: new Date("2026-11-01T00:00:00Z"),
      includePlanPool: true,
    });
    expect(usageWindow(now, true, pro)).toMatchObject({
      plan: "pro",
      scope: "workspace",
      monthStart: new Date("2026-11-01T00:00:00Z"),
      includePlanPool: false,
      includeGlobal: true,
    });
    // Limits without a plan (tests, older callers) are Free, per user, no month.
    expect(usageWindow(now, false)).toMatchObject({
      plan: "free",
      scope: "user",
      monthStart: null,
    });
  });
});

describe("decideQuota, day only", () => {
  it("allows when there is room, reporting today's count for the meter", () => {
    const verdict = decideQuota(counts({ userMinute: 1, day: 12 }), limits, undefined, now);
    expect(verdict).toMatchObject({ allowed: true, period: "day", used: 12, limit: 50 });
    expect(verdict.resetsAt.toISOString()).toBe("2026-11-05T00:00:00.000Z");
  });

  it("blocks at the daily limit until midnight UTC", () => {
    const verdict = decideQuota(counts({ day: 50 }), limits, undefined, now);
    expect(verdict).toMatchObject({
      allowed: false,
      window: "day",
      retryAfterSeconds: untilMidnight,
    });
  });

  it("blocks bursts for a minute", () => {
    const verdict = decideQuota(counts({ userMinute: 10, day: 10 }), limits, undefined, now);
    expect(verdict).toMatchObject({ allowed: false, window: "minute", retryAfterSeconds: 60 });
  });

  it("enforces the global daily OCR cap first", () => {
    expect(decideQuota(counts({ globalDay: 1000 }), limits, 1000, now)).toMatchObject({
      allowed: false,
      window: "global",
    });
    expect(decideQuota(counts({ globalDay: 999 }), limits, 1000, now).allowed).toBe(true);
  });
});

describe("decideQuota, Free (per user: 20 a day, 30 a month, shared pool)", () => {
  it("meters the user's month, with today alongside", () => {
    const verdict = decideQuota(counts({ day: 4, month: 12, planDay: 0 }), free, undefined, now);
    expect(verdict).toMatchObject({
      allowed: true,
      period: "month",
      scope: "user",
      used: 12,
      limit: 30,
      day: { used: 4, limit: 20 },
    });
  });

  it("refuses the 31st scan of the month until the 1st, 00:00 UTC", () => {
    expect(
      decideQuota(counts({ day: 5, month: 29, planDay: 0 }), free, undefined, now).allowed,
    ).toBe(true);
    const verdict = decideQuota(counts({ day: 5, month: 30, planDay: 0 }), free, undefined, now);
    expect(verdict).toMatchObject({
      allowed: false,
      window: "month",
      retryAfterSeconds: untilDecember,
    });
    expect(quotaMessage(verdict)).toBe(
      "You've used all 30 scans on the Free plan this month. They reset on 1 December at 00:00 UTC.",
    );
  });

  it("keeps 20 a day as the burst limit inside the month", () => {
    const verdict = decideQuota(counts({ day: 20, month: 25, planDay: 0 }), free, undefined, now);
    expect(verdict).toMatchObject({
      allowed: false,
      window: "day",
      retryAfterSeconds: untilMidnight,
    });
    expect(quotaMessage(verdict)).toBe(
      "You've used all 20 scans for today. You can upload again at 00:00 UTC.",
    );
  });

  it("closes the Free pool for everyone on Free once it is used up today", () => {
    const pool = free.planPoolPerDay!;
    expect(decideQuota(counts({ month: 0, planDay: pool }), free, undefined, now)).toMatchObject({
      allowed: false,
      window: "pool",
      retryAfterSeconds: untilMidnight,
    });
    expect(decideQuota(counts({ month: 0, planDay: pool - 1 }), free, undefined, now).allowed).toBe(
      true,
    );
  });
});

describe("decideQuota, Pro (per workspace: 500 a month, 200 a day)", () => {
  it("meters the workspace's month and today", () => {
    const verdict = decideQuota(counts({ day: 7, month: 120 }), pro, undefined, now);
    expect(verdict).toMatchObject({
      allowed: true,
      period: "month",
      scope: "workspace",
      used: 120,
      limit: 500,
      day: { used: 7, limit: 200 },
    });
    expect(verdict.resetsAt.toISOString()).toBe("2026-12-01T00:00:00.000Z");
  });

  it("blocks at 500 a month until the 1st, 00:00 UTC", () => {
    const verdict = decideQuota(counts({ month: 500 }), pro, undefined, now);
    expect(verdict).toMatchObject({
      allowed: false,
      window: "month",
      retryAfterSeconds: untilDecember,
    });
    expect(decideQuota(counts({ month: 499 }), pro, undefined, now).allowed).toBe(true);
  });

  it("blocks at 200 a day even with room left in the month", () => {
    const verdict = decideQuota(counts({ day: 200, month: 300 }), pro, undefined, now);
    expect(verdict).toMatchObject({ allowed: false, window: "day", used: 300, limit: 500 });
    expect(verdict.retryAfterSeconds).toBe(untilMidnight);
  });

  it("has no plan pool, so a full Free pool never blocks Pro", () => {
    expect(pro.planPoolPerDay).toBeNull();
    expect(decideQuota(counts({ month: 0, planDay: 1_000_000 }), pro, undefined, now).allowed).toBe(
      true,
    );
  });

  it("is still bounded by the global fuse", () => {
    expect(decideQuota(counts({ month: 0, globalDay: 10 }), pro, 10, now)).toMatchObject({
      allowed: false,
      window: "global",
    });
  });
});

describe("quotaMessage", () => {
  const base: QuotaVerdict = {
    allowed: false,
    period: "day",
    scope: "user",
    used: 50,
    limit: 50,
    resetsAt: now,
  };
  it("names the limit and the reset, and distinguishes the windows", () => {
    expect(quotaMessage({ ...base, window: "day" })).toContain("50");
    expect(quotaMessage({ ...base, window: "day" })).toContain("00:00 UTC");
    expect(quotaMessage({ ...base, window: "minute" })).toContain("minute");
    expect(quotaMessage({ ...base, window: "global" })).toContain("capacity");
    expect(quotaMessage({ ...base, window: "pool" })).toBe(
      "Free scanning is busy today: the Free plan's shared daily capacity is used up. Try again after 00:00 UTC.",
    );
  });

  it("shows the month's balance when a Pro workspace hits its daily limit", () => {
    const month = {
      ...base,
      scope: "workspace" as const,
      period: "month" as const,
      used: 320,
      limit: 500,
    };
    expect(quotaMessage({ ...month, window: "day", day: { used: 200, limit: 200 } })).toBe(
      "This workspace has used its 200 scans for today. Uploads open at 00:00 UTC; 180 of 500 scans are left this month.",
    );
    expect(
      quotaMessage({
        ...month,
        used: 500,
        window: "month",
        resetsAt: new Date("2026-12-01T00:00:00Z"),
      }),
    ).toBe(
      "This workspace has used all 500 scans for this month. They reset on 1 December at 00:00 UTC.",
    );
  });
});

describe("refuseQuota", () => {
  const poolFull = decideQuota(counts({ planDay: 300 }), free, undefined, now);
  const dayUsed = decideQuota(counts({ day: 20, month: 20 }), free, undefined, now);
  const warningsFrom = async (verdict: QuotaVerdict, at: Date) => {
    const logged: unknown[] = [];
    const logger = Logger.make(({ logLevel, message }) => {
      if (logLevel === LogLevel.Warning) logged.push([message].flat()[0]);
    });
    const exit = await Effect.runPromiseExit(
      refuseQuota(verdict, at).pipe(Effect.provide(Logger.replace(Logger.defaultLogger, logger))),
    );
    expect(Exit.isFailure(exit) && Cause.failureOption(exit.cause)).toMatchObject({
      value: { _tag: "QuotaExceeded", kind: verdict.window },
    });
    return logged;
  };

  it("warns on the first pool refusal of each UTC day only", async () => {
    expect(poolFull.window).toBe("pool");
    expect(await warningsFrom(poolFull, new Date("2031-03-01T08:00:00Z"))).toEqual([
      "quota.pool_full",
    ]);
    expect(await warningsFrom(poolFull, new Date("2031-03-01T23:59:00Z"))).toEqual([]);
    expect(await warningsFrom(poolFull, new Date("2031-03-02T00:00:00Z"))).toEqual([
      "quota.pool_full",
    ]);
  });

  it("never warns for a person's own limits", async () => {
    expect(dayUsed.window).toBe("day");
    expect(await warningsFrom(dayUsed, new Date("2031-04-01T08:00:00Z"))).toEqual([]);
  });
});
