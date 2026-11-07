import { describe, expect, it } from "vitest";
import { change, formatChange, formatMoney, formatSpan, formatValue, niceTicks } from "./format";

describe("formatMoney", () => {
  it("uses each currency's own decimals", () => {
    expect(formatMoney(1234.5, "USD")).toBe("$1,234.50");
    expect(formatMoney(1580, "JPY")).toBe("¥1,580");
    expect(formatMoney(41.25, "KWD")).toMatch(/41\.250$/);
  });

  it("shows whole rupiah and rupees without decimals, but keeps real fractions", () => {
    expect(formatMoney(150000, "IDR")).toMatch(/150,000$/);
    expect(formatMoney(1450, "NPR")).toMatch(/1,450$/);
    expect(formatMoney(12.5, "NPR")).toMatch(/12\.50$/);
  });

  it("falls back to the code for a currency Intl doesn't know", () => {
    expect(formatMoney(3, "US$")).toBe("US$ 3.00");
  });

  it("shortens axis labels and big totals only", () => {
    expect(formatValue(1500, { kind: "money", currency: "GBP" }, { axis: true })).toBe("£1.5K");
    expect(formatValue(1500, { kind: "money", currency: "GBP" }, { compact: true })).toBe(
      "£1,500.00",
    );
    expect(formatValue(1234, { kind: "count" })).toBe("1,234");
    expect(formatValue(1500, { kind: "ms" })).toBe("1.5 s");
  });
});

describe("change", () => {
  it("is null without a previous amount, and signed otherwise", () => {
    expect(change(10, 0)).toBeNull();
    expect(formatChange(change(150, 100)!)).toBe("+50%");
    expect(formatChange(change(50, 100)!)).toBe("−50%");
    expect(formatChange(0.001)).toBe("0%");
  });
});

describe("niceTicks", () => {
  it("steps by 1, 2 or 5 times a power of ten and covers the maximum", () => {
    expect(niceTicks(0)).toEqual([0]);
    expect(niceTicks(1623.7)).toEqual([0, 500, 1000, 1500, 2000]);
    expect(niceTicks(128)).toEqual([0, 50, 100, 150]);
    expect(niceTicks(7)).toEqual([0, 2, 4, 6, 8]);
  });
});

describe("formatSpan", () => {
  it("drops the repeated year", () => {
    expect(formatSpan("2026-10-08", "2026-11-06")).toBe("8 Oct – 6 Nov 2026");
    expect(formatSpan("2025-12-01", "2026-01-31")).toBe("1 Dec 2025 – 31 Jan 2026");
    expect(formatSpan("2026-11-06", "2026-11-06")).toBe("6 Nov 2026");
  });
});

describe("whole-unit currencies", () => {
  it("fixes the fraction digits for both whole and fractional IDR amounts", () => {
    expect(formatMoney(150000, "IDR")).toMatch(/150,000$/);
    expect(formatMoney(150000.5, "IDR")).toMatch(/150,000\.50$/);
  });
});
