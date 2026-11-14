import { describe, expect, it } from "vitest";
import {
  editedReasons,
  isDateReason,
  lineNeedsCheck,
  reviewReasons,
  withLineChecks,
  totalsMismatch,
  type CheckedFields,
} from "../src/review-reasons";

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

describe("totalsMismatch rounding", () => {
  it("accepts a whole-number total rounded to the unit, as NPR bills are", () => {
    // 1000 + 13% VAT 130.45 = 1130.45, printed as 1130 or 1131.
    const bill = { subtotal: "1000.00", tax: "130.45" };
    expect(totalsMismatch(fields({ ...bill, total: "1130.00" }))).toBe(null);
    expect(totalsMismatch(fields({ ...bill, total: "1131.00" }))).toBe(null);
  });

  it("still flags a gap of a whole unit, or any gap on a total with cents", () => {
    expect(totalsMismatch(fields({ subtotal: "1000.00", tax: "130.00", total: "1131.00" }))).toBe(
      1130,
    );
    expect(totalsMismatch(fields({ subtotal: "1000.00", tax: "130.45", total: "1130.40" }))).toBe(
      1130.45,
    );
  });
});

describe("editedReasons", () => {
  const base = fields({ lines: ["10.00"], total: "10.00" });

  it("rechecks only the reasons that read a changed field", () => {
    expect(editedReasons(["no_merchant"], { ...base, total: "12.00" }, new Set(["total"]))).toEqual(
      ["no_merchant", "totals_mismatch"],
    );
    expect(editedReasons(["no_merchant"], base, new Set(["merchant"]))).toEqual([]);
  });

  it("adds nothing for fields the edit didn't touch, so an old receipt isn't newly flagged", () => {
    expect(editedReasons([], { ...base, merchant: null, total: "12.00" }, new Set())).toEqual([]);
  });

  it("keeps low_confidence and codes it doesn't know", () => {
    expect(editedReasons(["low_confidence", "something_new"], base, new Set(["total"]))).toEqual([
      "low_confidence",
      "something_new",
    ]);
  });

  it("drops the date reasons when the date or its calendar changed", () => {
    expect(editedReasons(["date_conflict"], base, new Set(["tax"]))).toEqual(["date_conflict"]);
    expect(editedReasons(["date_conflict"], base, new Set(["receiptDateCalendar"]))).toEqual([]);
    expect(
      editedReasons(["date_implausible"], { ...base, receiptDate: null }, new Set(["receiptDate"])),
    ).toEqual(["no_date"]);
  });
});

describe("lineNeedsCheck", () => {
  const line = (quantity: number, unitPrice: string | null, totalPrice: string | null) => ({
    quantity,
    unitPrice,
    totalPrice,
  });

  it("accepts a line whose quantity times unit price is its total", () => {
    expect(lineNeedsCheck(line(1, "10.00", "10.00"), "USD")).toBe(false);
    expect(lineNeedsCheck(line(2, "4.50", "9.00"), "USD")).toBe(false);
  });

  it("marks a line that disagrees beyond rounding", () => {
    expect(lineNeedsCheck(line(3, "3.79", "15.16"), "USD")).toBe(true);
    expect(lineNeedsCheck(line(1, "10.00", "10.02"), "USD")).toBe(true);
  });

  it("allows rounding of a printed unit price and fractional quantities", () => {
    expect(lineNeedsCheck(line(3, "3.33", "10.00"), "USD")).toBe(false);
    expect(lineNeedsCheck(line(1, "4.99", "3.74"), "USD", 0.75)).toBe(false);
    expect(lineNeedsCheck(line(1, "4.99", "4.20"), "USD", 0.75)).toBe(true);
  });

  it("uses the currency's minor unit", () => {
    expect(lineNeedsCheck(line(1, "500", "501"), "JPY")).toBe(true);
    expect(lineNeedsCheck(line(1, "500", "500"), "JPY")).toBe(false);
    expect(lineNeedsCheck(line(1, "1.000", "1.001"), "KWD")).toBe(true);
    expect(lineNeedsCheck(line(1, "1.00", "1.004"), null)).toBe(false);
  });

  it("marks a missing total but not a missing unit price", () => {
    expect(lineNeedsCheck(line(1, "10.00", null), "USD")).toBe(true);
    expect(lineNeedsCheck(line(1, null, "10.00"), "USD")).toBe(false);
  });

  it("accepts discount lines with negative amounts", () => {
    expect(lineNeedsCheck(line(1, "-5.00", "-5.00"), "USD")).toBe(false);
    expect(lineNeedsCheck(line(1, "-5.00", "5.00"), "USD")).toBe(true);
  });

  it("uses the printed quantity when the extraction has one", () => {
    expect(lineNeedsCheck(line(1, "120.00", "90.00"), "USD", 0.75)).toBe(false);
    expect(lineNeedsCheck(line(1, "120.00", "100.00"), "USD", 0.75)).toBe(true);
    expect(lineNeedsCheck(line(2, "5.00", "15.00"), "USD", 2)).toBe(true);
  });

  it("doesn't mark a weighed line stored as quantity 1 when only the rounded quantity is known", () => {
    expect(lineNeedsCheck(line(1, "120.00", "90.00"), "USD")).toBe(false);
    expect(lineNeedsCheck(line(1, "7.99", "2.40"), "USD")).toBe(false);
    expect(lineNeedsCheck(line(1, "10.00", "20.00"), "USD")).toBe(true);
  });
});

describe("withLineChecks", () => {
  const items = [
    { quantity: 1, unitPrice: "120.00", totalPrice: "90.00" },
    { quantity: 1, unitPrice: "10.00", totalPrice: "20.00" },
    { quantity: 2, unitPrice: "4.50", totalPrice: "9.00" },
  ];
  const marks = (rawJson: unknown) =>
    withLineChecks(items, "USD", rawJson).map((i) => i.needsCheck);

  it("matches printed quantities to lines by order", () => {
    const raw = { items: [{ quantity: 0.75 }, { quantity: 1 }, { quantity: 2 }] };
    expect(marks(raw)).toEqual([false, true, false]);
  });

  it("falls back to stored quantities without a usable raw extraction", () => {
    expect(marks(null)).toEqual([false, true, false]);
    expect(marks({ items: "bad" })).toEqual([false, true, false]);
  });
});
