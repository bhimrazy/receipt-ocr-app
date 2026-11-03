import { describe, expect, it } from "vitest";
import { decideQuota, nextUtcMidnight, quotaMessage, utcDayStart } from "./quota";

const limits = { perMinute: 10, perDay: 50 };
const now = new Date("2026-11-04T18:30:00Z");

describe("usage window", () => {
  it("is the UTC calendar day", () => {
    expect(utcDayStart(now).toISOString()).toBe("2026-11-04T00:00:00.000Z");
    expect(nextUtcMidnight(now).toISOString()).toBe("2026-11-05T00:00:00.000Z");
    expect(nextUtcMidnight(new Date("2026-12-31T23:59:59Z")).toISOString()).toBe(
      "2027-01-01T00:00:00.000Z",
    );
  });
});

describe("decideQuota", () => {
  it("allows when there is room, reporting today's count for the meter", () => {
    const verdict = decideQuota(
      { userMinute: 1, userDay: 12, globalDay: null },
      limits,
      undefined,
      now,
    );
    expect(verdict).toMatchObject({ allowed: true, used: 12, limit: 50 });
    expect(verdict.resetsAt.toISOString()).toBe("2026-11-05T00:00:00.000Z");
  });

  it("blocks at the daily limit until midnight UTC", () => {
    const verdict = decideQuota(
      { userMinute: 0, userDay: 50, globalDay: null },
      limits,
      undefined,
      now,
    );
    expect(verdict).toMatchObject({ allowed: false, window: "day", retryAfterSeconds: 5.5 * 3600 });
  });

  it("blocks bursts for a minute", () => {
    const verdict = decideQuota(
      { userMinute: 10, userDay: 10, globalDay: null },
      limits,
      undefined,
      now,
    );
    expect(verdict).toMatchObject({ allowed: false, window: "minute", retryAfterSeconds: 60 });
  });

  it("enforces the global daily OCR cap (U5) ahead of the user's own room", () => {
    const verdict = decideQuota({ userMinute: 0, userDay: 0, globalDay: 1000 }, limits, 1000, now);
    expect(verdict).toMatchObject({ allowed: false, window: "global" });
    expect(
      decideQuota({ userMinute: 0, userDay: 0, globalDay: 999 }, limits, 1000, now).allowed,
    ).toBe(true);
  });
});

describe("quotaMessage", () => {
  it("names the limit and the reset, and distinguishes the windows", () => {
    const base = { allowed: false, used: 50, limit: 50, resetsAt: now };
    expect(quotaMessage({ ...base, window: "day" })).toContain("50");
    expect(quotaMessage({ ...base, window: "day" })).toContain("00:00 UTC");
    expect(quotaMessage({ ...base, window: "minute" })).toContain("minute");
    expect(quotaMessage({ ...base, window: "global" })).toContain("capacity");
  });
});
