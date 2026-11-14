import { describe, expect, it } from "vitest";
import { meterNote, remainingSpan, usageWarns, type Usage } from "@/components/usage-meter";

const usage = (used: number, day: number, over: Partial<Usage> = {}): Usage => ({
  period: "month",
  scope: "workspace",
  used,
  limit: 500,
  resetsAt: new Date("2026-12-01T00:00:00Z"),
  day: { used: day, limit: 200 },
  blocked: null,
  opensAt: new Date("2026-12-01T00:00:00Z"),
  ...over,
});

describe("usageWarns", () => {
  it("warns when today's limit is nearly used, even with the month well under", () => {
    expect(usageWarns(usage(300, 195))).toBe(true);
    expect(usageWarns(usage(300, 100))).toBe(false);
  });

  it("warns from 80% of the month, and while blocked", () => {
    expect(usageWarns(usage(400, 0))).toBe(true);
    expect(usageWarns(usage(10, 0, { blocked: "pool" }))).toBe(true);
  });
});

describe("remainingSpan", () => {
  it("names the window the room left comes from", () => {
    expect(remainingSpan(usage(497, 10))).toBe("this month");
    expect(remainingSpan(usage(100, 198))).toBe("today");
    expect(remainingSpan(usage(5, 0, { period: "day", limit: 20, day: undefined }))).toBe("today");
  });
});

describe("meterNote", () => {
  it("gives the UTC time a used-up day opens, not 'tomorrow'", () => {
    expect(meterNote(usage(320, 200, { blocked: "day" }))).toBe(
      "Today's limit reached · opens 00:00 UTC",
    );
  });
});
