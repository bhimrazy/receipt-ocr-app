import { describe, expect, it } from "vitest";
import {
  meterNote,
  remainingSpan,
  stripNote,
  usageWarns,
  type Usage,
} from "@/components/usage-meter";

const usage = (used: number, day: number, over: Partial<Usage> = {}): Usage => ({
  period: "month",
  scope: "workspace",
  used,
  limit: 50,
  resetsAt: new Date("2026-12-01T00:00:00Z"),
  day: { used: day, limit: 20 },
  blocked: null,
  opensAt: new Date("2026-12-01T00:00:00Z"),
  ...over,
});

describe("usageWarns", () => {
  it("warns when today's limit is nearly used, even with the month well under", () => {
    expect(usageWarns(usage(25, 17))).toBe(true);
    expect(usageWarns(usage(25, 10))).toBe(false);
  });

  it("warns from 80% of the month, and while blocked", () => {
    expect(usageWarns(usage(40, 0))).toBe(true);
    expect(usageWarns(usage(9, 0, { blocked: "pool" }))).toBe(true);
  });
});

describe("remainingSpan", () => {
  it("names the window the room left comes from", () => {
    expect(remainingSpan(usage(47, 10))).toBe("this month");
    expect(remainingSpan(usage(10, 18))).toBe("today");
    expect(remainingSpan(usage(5, 0, { period: "day", limit: 20, day: undefined }))).toBe("today");
  });
});

describe("meterNote", () => {
  it("talks about the month only, until today's limit is near", () => {
    expect(meterNote(usage(0, 0))).toBe("50 left this month");
    expect(meterNote(usage(9, 15))).toBe("41 left this month");
    expect(meterNote(usage(25, 17))).toBe("3 left today");
  });

  it("adds the reset date from 80% of the month", () => {
    expect(meterNote(usage(40, 5))).toBe("10 left · resets 1 December");
  });

  it("puts a used-up month before a used-up day, and gives the UTC opening time", () => {
    expect(meterNote(usage(50, 20, { blocked: "month" }))).toBe("Limit reached · opens 1 December");
    expect(
      meterNote(usage(30, 20, { blocked: "day", opensAt: new Date("2026-11-15T00:00:00Z") })),
    ).toBe("Today's limit reached · opens 00:00 UTC");
  });

  it("says when scanning is paused or the Free pool is full", () => {
    const at = { opensAt: new Date("2026-11-15T00:00:00Z") };
    expect(meterNote(usage(9, 0, { blocked: "global", ...at }))).toBe(
      "Paused for everyone · opens 00:00 UTC",
    );
    expect(meterNote(usage(9, 0, { blocked: "pool", ...at }))).toBe(
      "Free scanning busy · opens 00:00 UTC",
    );
  });
});

describe("stripNote", () => {
  it("shows from 80% of either window while uploads are open", () => {
    expect(stripNote(usage(9, 5))).toBeNull();
    expect(stripNote(usage(40, 5))).toBe("10 scans left this month · resets 1 December");
    expect(stripNote(usage(25, 17))).toBe("3 scans left today");
    expect(stripNote(usage(50, 0, { blocked: "month" }))).toBeNull();
  });
});
