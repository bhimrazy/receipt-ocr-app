import { describe, expect, it } from "vitest";
import { formatReceiptDate, formatTimeUntil, money, pct, receiptDateParts } from "./format";

describe("money", () => {
  it("formats decimal strings from numeric columns", () => {
    expect(money("11.00")).toBe("$11.00");
    expect(money(11)).toBe("$11.00");
  });

  it("honours the currency", () => {
    expect(money("11.00", "EUR")).toContain("11.00");
  });

  it("treats null, undefined, and unparseable values as zero", () => {
    expect(money(null)).toBe("$0.00");
    expect(money(undefined)).toBe("$0.00");
    expect(money("not a number")).toBe("$0.00");
  });
});

describe("pct", () => {
  it("renders a 0–1 confidence as a percentage", () => {
    expect(pct("0.9500")).toBe("95%");
    expect(pct(1)).toBe("100%");
    expect(pct(0)).toBe("0%");
  });

  it("treats missing confidence as zero", () => {
    expect(pct(null)).toBe("0%");
    expect(pct(undefined)).toBe("0%");
  });
});

describe("formatTimeUntil", () => {
  const now = new Date("2026-11-04T17:30:00Z");
  it("uses minutes under an hour and whole hours above", () => {
    expect(formatTimeUntil(new Date("2026-11-04T17:31:00Z"), now)).toBe("in 1 minute");
    expect(formatTimeUntil(new Date("2026-11-04T18:15:00Z"), now)).toBe("in 45 minutes");
    expect(formatTimeUntil(new Date("2026-11-05T00:00:00Z"), now)).toBe("in 6 hours");
  });
  it("switches to days past 48 hours, rounding up", () => {
    expect(formatTimeUntil(new Date("2026-11-06T17:30:00Z"), now)).toBe("in 48 hours");
    expect(formatTimeUntil(new Date("2026-11-06T18:30:00Z"), now)).toBe("in 3 days");
    expect(formatTimeUntil(new Date("2026-12-01T00:00:00Z"), now)).toBe("in 27 days");
  });
  it("never says zero or a past time", () => {
    expect(formatTimeUntil(new Date("2026-11-04T17:00:00Z"), now)).toBe("in 1 minute");
  });
});

describe("formatReceiptDate", () => {
  it("shows a receipt that printed Bikram Sambat in BS first, with the AD day", () => {
    expect(formatReceiptDate("2023-07-25", "bikram-sambat")).toBe("9 Shrawan 2080 · 25 Jul 2023");
    expect(receiptDateParts("2023-07-25", "bikram-sambat")).toEqual({
      bs: "9 Shrawan 2080",
      ad: "25 Jul 2023",
    });
  });

  it("shows every other receipt in AD only", () => {
    expect(formatReceiptDate("2023-07-25", "gregory")).toBe("25 Jul 2023");
    expect(formatReceiptDate("2023-07-25", null)).toBe("25 Jul 2023");
    expect(formatReceiptDate(null, "bikram-sambat")).toBeNull();
  });
});
