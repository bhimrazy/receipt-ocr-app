import { describe, expect, it } from "vitest";
import { parseSpendSearch, resolveRange } from "../../src/analytics/range";
import { assembleDashboard, minorUnits } from "../../src/analytics/spend";

const today = "2026-11-06";
const range = resolveRange(parseSpendSearch({}), today);

// Grouping ids of the grouping sets in spend.ts.
const TOTAL = 63;
const CATEGORY = 47;
const MERCHANT = 55;

const base = {
  currency: "USD",
  bucket: null,
  category: null,
  merchant_key: null,
  month: null,
  day: null,
  dow: null,
  merchant_name: null,
  range_total: "0",
  range_count: 0,
  range_tax: "0",
  range_fallback: 0,
  prev_total: "0",
  prev_count: 0,
  year_total: "0",
  year_count: 0,
  months_total: "0",
  months_count: 0,
};

describe("minorUnits", () => {
  it("is a fixed ISO 4217 table, the same in every runtime", () => {
    expect(["JPY", "KRW", "VND", "CLP"].map(minorUnits)).toEqual([0, 0, 0, 0]);
    expect(["KWD", "BHD", "OMR", "JOD", "TND", "LYD", "IQD"].map(minorUnits)).toEqual([
      3, 3, 3, 3, 3, 3, 3,
    ]);
    // Runtimes disagree on these through Intl; ISO says 2.
    expect(["IDR", "HUF", "PKR", "USD", "EUR", "NPR", "???"].map(minorUnits)).toEqual([
      2, 2, 2, 2, 2, 2, 2,
    ]);
    expect(minorUnits("kwd")).toBe(3);
  });
});

describe("assembleDashboard", () => {
  const rows = (currency: string, n: number, each: string) => [
    { ...base, g: TOTAL, currency, range_total: String(Number(each) * n), range_count: n },
    ...Array.from({ length: n }, (_, i) => ({
      ...base,
      g: CATEGORY,
      currency,
      category: `C${i}`,
      range_total: each,
      range_count: 1,
    })),
    ...Array.from({ length: Math.min(n, 10) }, (_, i) => ({
      ...base,
      g: MERCHANT,
      currency,
      merchant_key: `m${i}`,
      range_total: each,
      range_count: 1,
    })),
  ];

  it("keeps ten entries and sums the rest of the categories and merchants", () => {
    const [usd] = assembleDashboard(rows("USD", 13, "2"), [], range, today).currencies;
    expect(usd!.categories.top).toHaveLength(10);
    expect(usd!.categories.rest).toEqual({ total: 6, count: 3, groups: 3 });
    expect(usd!.merchants.top).toHaveLength(10);
    expect(usd!.merchants.rest).toEqual({ total: 6, count: 3, groups: null });
  });

  it("has no rest when everything fits, and rounds to the currency's minor unit", () => {
    const [kwd] = assembleDashboard(rows("KWD", 2, "1.2504"), [], range, today).currencies;
    expect(kwd!.categories.rest).toBeNull();
    const [jpy] = assembleDashboard([...rows("JPY", 12, "100.4")], [], range, today).currencies;
    expect(jpy!.categories.rest!.total).toBe(201);
  });
});
