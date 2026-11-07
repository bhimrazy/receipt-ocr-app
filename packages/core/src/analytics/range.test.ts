import { describe, expect, it } from "vitest";
import { daySpan } from "./dates";
import { MAX_RANGE_DAYS, parseSpendSearch, resolveDateValue, resolveRange } from "./range";

const today = "2026-11-06";
const range = (params: Record<string, string | string[] | undefined>) =>
  resolveRange(parseSpendSearch(params), today);

describe("parseSpendSearch", () => {
  it("drops bad values instead of throwing", () => {
    expect(
      parseSpendSearch({
        range: "forever",
        compare: "maybe",
        currency: "US$",
        from: "x".repeat(99),
      }),
    ).toEqual({});
  });

  it("takes the first of repeated params and upper-cases the currency", () => {
    expect(parseSpendSearch({ range: ["3m", "12m"], currency: "eur" })).toEqual({
      range: "3m",
      currency: "EUR",
    });
  });
});

describe("resolveDateValue", () => {
  it("reads relative values and clamps month ends", () => {
    expect(resolveDateValue("today", today)).toBe(today);
    expect(resolveDateValue("-30d", today)).toBe("2026-10-07");
    expect(resolveDateValue("-2w", today)).toBe("2026-10-23");
    expect(resolveDateValue("-3mo", "2026-05-31")).toBe("2026-02-28");
    expect(resolveDateValue("-1y", "2028-02-29")).toBe("2027-02-28");
  });

  it("rejects dates that don't exist", () => {
    expect(resolveDateValue("2026-02-30", today)).toBeNull();
    expect(resolveDateValue("+3d", today)).toBeNull();
  });
});

describe("resolveRange", () => {
  it("defaults to the last 30 days, daily, against the 30 before", () => {
    expect(range({})).toEqual({
      preset: "30d",
      from: "2026-10-08",
      to: today,
      unit: "day",
      compare: true,
      previous: { from: "2026-09-08", to: "2026-10-07", kind: "previous-period" },
    });
  });

  it("buckets 3 months weekly and 12 months monthly", () => {
    expect(range({ range: "3m" })).toMatchObject({ from: "2026-08-09", unit: "week" });
    expect(range({ range: "12m" })).toMatchObject({
      from: "2025-12-01",
      unit: "month",
      previous: { from: "2024-12-01", to: "2025-11-06", kind: "last-year" },
    });
  });

  it("compares 12 months with a period of the same length, so flat spending reads 0%", () => {
    const r = range({ range: "12m" });
    // A leap day can add one; before it was 342 days against 365.
    expect(Math.abs(daySpan(r.previous.from, r.previous.to) - daySpan(r.from, r.to))).toBeLessThan(
      2,
    );
    expect(daySpan(r.from, r.to)).toBe(daySpan("2025-12-01", today));
  });

  it("compares year to date with the same days last year", () => {
    expect(range({ range: "ytd" })).toMatchObject({
      from: "2026-01-01",
      unit: "month",
      previous: { from: "2025-01-01", to: "2025-11-06", kind: "last-year" },
    });
  });

  it("treats from/to without a preset as custom, swapping a reversed pair", () => {
    expect(range({ from: "2026-10-31", to: "2026-10-01" })).toMatchObject({
      preset: "custom",
      from: "2026-10-01",
      to: "2026-10-31",
      unit: "day",
      previous: { from: "2026-08-31", to: "2026-09-30" },
    });
    expect(range({ from: "-3mo", to: "today" })).toMatchObject({ from: "2026-08-06", to: today });
  });

  it("shortens an overlong custom range and falls back when from is unreadable", () => {
    const long = range({ range: "custom", from: "2000-01-01", to: today });
    expect(long.to).toBe(today);
    expect(long.from > "2000-01-01").toBe(true);
    expect(range({ range: "custom", from: "nope" }).preset).toBe("30d");
    expect(MAX_RANGE_DAYS).toBeGreaterThan(366);
  });

  it("treats relative dates that leave the calendar as unreadable, never throws", () => {
    for (const bad of ["-2000y", "-9999y"]) {
      expect(resolveDateValue(bad, today)).toBeNull();
      expect(range({ from: bad }).preset).toBe("30d");
      expect(() => range({ from: "2026-01-01", to: bad })).not.toThrow();
    }
    expect(() => range({ from: "-9999mo" })).not.toThrow();
    expect(resolveDateValue("-9999d", today)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("turns the comparison off with compare=0", () => {
    expect(range({ compare: "0" }).compare).toBe(false);
  });
});
