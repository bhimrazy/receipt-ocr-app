import { describe, expect, it } from "vitest";
import {
  isIsoDay,
  latestReceiptDate,
  MAX_ITEM_QUANTITY,
  parseCurrency,
  parseReceiptDate,
  storableAmount,
  storableQuantity,
} from "../src/receipt-fields";

describe("storableAmount", () => {
  it("keeps any amount numeric(12,2) holds once rounded, negative too", () => {
    expect(storableAmount(12.5)).toBe("12.5");
    expect(storableAmount(-3)).toBe("-3");
    expect(storableAmount(0)).toBe("0");
    expect(storableAmount(9_999_999_999.99)).toBe("9999999999.99");
    expect(storableAmount(-9_999_999_999.994)).toBe("-9999999999.994");
  });

  it("drops a missing amount, or one that would overflow the column", () => {
    for (const value of [null, undefined, 4111111111111111, 1e12, 9_999_999_999.995, -1e10, NaN]) {
      expect(storableAmount(value)).toBeNull();
    }
  });
});

describe("storableQuantity", () => {
  it("rounds to whole units, at least 1", () => {
    expect(storableQuantity(2.4)).toBe(2);
    expect(storableQuantity(0.25)).toBe(1);
    expect(storableQuantity(0)).toBe(1);
    expect(storableQuantity(-4)).toBe(1);
    expect(storableQuantity(MAX_ITEM_QUANTITY)).toBe(MAX_ITEM_QUANTITY);
  });

  it("reads an implausible or missing quantity as 1, so it always fits int4", () => {
    for (const value of [MAX_ITEM_QUANTITY + 1, 1e12, NaN, null]) {
      expect(storableQuantity(value)).toBe(1);
    }
  });
});

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
