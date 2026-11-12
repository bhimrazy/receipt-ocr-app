import { describe, expect, it } from "vitest";
import { isDateReason, reviewReasons, totalsMismatch, type CheckedFields } from "./review-reasons";

const fields = ({ lines = [], ...rest }: Partial<CheckedFields> & { lines?: string[] }) => ({
  merchant: "Test Shop",
  receiptDate: "2026-11-01",
  currency: "USD",
  subtotal: null,
  tax: null,
  tip: null,
  discount: null,
  serviceCharge: null,
  total: null,
  items: lines.map((totalPrice) => ({ totalPrice })),
  ...rest,
});

describe("totalsMismatch", () => {
  it("accepts prices that already include tax: total equals the line sum or the subtotal", () => {
    expect(totalsMismatch(fields({ lines: ["10.00", "5.00"], tax: "1.36", total: "15.00" }))).toBe(
      null,
    );
    expect(totalsMismatch(fields({ subtotal: "15.00", tax: "1.36", total: "15.00" }))).toBe(null);
    expect(
      totalsMismatch(
        fields({ lines: ["10.00", "5.00"], tax: "1.36", tip: "2.00", total: "17.00" }),
      ),
    ).toBe(null);
  });

  it("counts negative lines as discounts", () => {
    expect(
      totalsMismatch(fields({ lines: ["10.00", "5.00", "-2.50"], tax: "1.00", total: "13.50" })),
    ).toBe(null);
    expect(totalsMismatch(fields({ lines: ["10.00", "-2.50"], total: "7.50" }))).toBe(null);
  });

  it("accepts tax and tip added on top", () => {
    expect(
      totalsMismatch(fields({ subtotal: "20.00", tax: "1.60", tip: "3.00", total: "24.60" })),
    ).toBe(null);
  });

  it("takes off a discount and adds a service charge (a Nepali restaurant bill)", () => {
    // 1000 - 100 discount + 10% service charge 90 + 13% VAT 128.70 = 1118.70
    const bill = { subtotal: "1000.00", discount: "100.00", serviceCharge: "90.00", tax: "128.70" };
    expect(totalsMismatch(fields({ ...bill, total: "1118.70" }))).toBe(null);
    expect(totalsMismatch(fields({ ...bill, serviceCharge: null, total: "1118.70" }))).toBe(1028.7);
  });

  it("doesn't take a discount off twice when a discount line is already in the items", () => {
    expect(
      totalsMismatch(fields({ lines: ["10.00", "-2.00"], discount: "2.00", total: "8.00" })),
    ).toBe(null);
  });

  it("flags a real mismatch with the sum it expected", () => {
    expect(totalsMismatch(fields({ lines: ["10.00", "5.00"], tax: "1.20", total: "19.99" }))).toBe(
      16.2,
    );
    expect(totalsMismatch(fields({ subtotal: "20.00", tax: "1.60", total: "30.00" }))).toBe(21.6);
  });

  it("compares to the cent: a one-cent gap always counts, float sums never do", () => {
    expect(totalsMismatch(fields({ lines: ["0.06"], total: "0.07" }))).toBe(0.06);
    expect(totalsMismatch(fields({ lines: ["0.10", "0.20"], total: "0.30" }))).toBe(null);
    expect(totalsMismatch(fields({ subtotal: "0.10", tax: "0.20", total: "0.30" }))).toBe(null);
  });

  it("has nothing to compare without a total or any amounts", () => {
    expect(totalsMismatch(fields({ lines: ["1.00"] }))).toBe(null);
    expect(totalsMismatch(fields({ total: "5.00" }))).toBe(null);
  });
});

describe("reviewReasons", () => {
  it("is empty for a complete receipt that adds up", () => {
    expect(reviewReasons(fields({ lines: ["10.00"], total: "10.00" }))).toEqual([]);
  });

  it("names each missing required field: merchant, date, total, currency", () => {
    expect(
      reviewReasons(fields({ merchant: " ", receiptDate: null, currency: null, total: null })),
    ).toEqual(["no_merchant", "no_date", "no_total", "no_currency"]);
  });

  it("adds a totals mismatch", () => {
    expect(reviewReasons(fields({ lines: ["10.00"], total: "12.00" }))).toEqual([
      "totals_mismatch",
    ]);
  });

  it("keeps the resolver's date reasons, in a fixed order", () => {
    expect(reviewReasons(fields({ total: "1.00" }), ["date_conflict", "date_ambiguous"])).toEqual([
      "date_ambiguous",
      "date_conflict",
    ]);
  });

  it("says the date was implausible rather than missing when the resolver rejected it", () => {
    expect(
      reviewReasons(fields({ receiptDate: null, total: "1.00" }), ["date_implausible"]),
    ).toEqual(["date_implausible"]);
  });

  it("tells date reasons apart", () => {
    expect(["date_conflict", "no_date", "low_confidence"].filter(isDateReason)).toEqual([
      "date_conflict",
    ]);
  });
});
