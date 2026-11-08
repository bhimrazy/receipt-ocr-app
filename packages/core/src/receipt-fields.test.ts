import { describe, expect, it } from "vitest";
import { isIsoDay, latestReceiptDate, parseCurrency, parseReceiptDate } from "./receipt-fields";

describe("parseReceiptDate", () => {
  it("keeps a real ISO day from 2000 on, trimmed", () => {
    expect(parseReceiptDate("2026-10-14")).toBe("2026-10-14");
    expect(parseReceiptDate(" 2024-02-29 ")).toBe("2024-02-29");
    expect(parseReceiptDate("2000-01-01")).toBe("2000-01-01");
  });

  it.each([
    null,
    undefined,
    "",
    "2026-02-30",
    "2025-02-29",
    "2026-13-01",
    "14/09/26",
    "2026-10-14T10:00:00Z",
    "1999-12-31",
    "0099-01-01",
  ])("drops %s", (value) => {
    expect(parseReceiptDate(value)).toBeNull();
  });
});

describe("isIsoDay", () => {
  it("accepts any real day, before 2000 too, and nothing a date cast would reject", () => {
    expect(isIsoDay("1999-12-31")).toBe(true);
    expect(isIsoDay("2024-02-29")).toBe(true);
    for (const value of ["2026-02-30", "0000-01-01", "2026-1-01", " 2026-01-01"]) {
      expect(isIsoDay(value)).toBe(false);
    }
  });
});

describe("latestReceiptDate", () => {
  it("is the day after the UTC upload day", () => {
    expect(latestReceiptDate(new Date("2026-11-08T23:30:00Z"))).toBe("2026-11-09");
    expect(latestReceiptDate("2026-12-31T00:00:00Z")).toBe("2027-01-01");
  });
});

describe("parseCurrency", () => {
  it("upper-cases a three-letter code and drops anything else", () => {
    expect(parseCurrency(" npr ")).toBe("NPR");
    expect(parseCurrency("US$")).toBeNull();
    expect(parseCurrency("Rs.")).toBeNull();
    expect(parseCurrency(null)).toBeNull();
  });
});
