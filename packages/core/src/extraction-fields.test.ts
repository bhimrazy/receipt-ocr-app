import type { ReceiptExtraction } from "@receipt-ocr/ai";
import { describe, expect, it } from "vitest";
import { storedExtraction } from "./extraction-fields";

const UPLOAD_DAY = "2026-11-10";

type Date3 = NonNullable<ReceiptExtraction["dates"]>[number];
const printed = (text: string, label: string | null = null): Date3 => ({
  text,
  label,
  calendar: null,
  role: "transaction",
});

/** A v3 reply for an NPR restaurant bill that balances: 1000 + 100 service + 143 VAT = 1243. */
const reply = (overrides: Partial<ReceiptExtraction> = {}): ReceiptExtraction => ({
  merchant: "Test Momo House",
  receiptDate: null,
  dates: [printed("15/07/2082", "Miti")],
  invoiceNumber: "B-1042",
  merchantTaxId: "999000001",
  category: "Meals",
  currency: "NPR",
  subtotal: 1000,
  discount: null,
  serviceCharge: 100,
  tax: 143,
  tip: null,
  total: 1243,
  confidence: 0.9,
  items: [
    { name: "Buff Momo", quantity: 2, unitPrice: 300, totalPrice: 600, confidence: 0.9 },
    { name: "Masala Tea", quantity: 4, unitPrice: 100, totalPrice: 400, confidence: 0.9 },
  ],
  ...overrides,
});

describe("storedExtraction", () => {
  it("converts a BS-only date, tags the calendar and needs no review", () => {
    const stored = storedExtraction(reply(), UPLOAD_DAY);
    expect(stored).toMatchObject({
      receiptDate: "2025-11-01",
      receiptDateCalendar: "bikram-sambat",
      reviewReasons: [],
    });
  });

  it("stores the AD date when a Miti beside it agrees", () => {
    const dates = [printed("10/21/2026", "Date"), printed("04/07/2083", "Miti")];
    const stored = storedExtraction(reply({ dates, receiptDate: "2026-10-21" }), UPLOAD_DAY);
    expect(stored).toMatchObject({
      receiptDate: "2026-10-21",
      receiptDateCalendar: "bikram-sambat",
      reviewReasons: [],
    });
  });

  it("flags an AD date and a Miti that disagree, keeping the Miti for NPR", () => {
    const dates = [printed("10/21/2026", "Date"), printed("09/07/2083", "Miti")];
    const stored = storedExtraction(reply({ dates }), UPLOAD_DAY);
    expect(stored.receiptDate).toBe("2026-10-26");
    expect(stored.reviewReasons).toEqual(["date_conflict"]);
  });

  it("flags day/month order it can't settle, storing the model's reading", () => {
    const dates = [printed("05/06/2026", "Date")];
    const stored = storedExtraction(reply({ dates, receiptDate: "2026-06-05" }), UPLOAD_DAY);
    expect(stored).toMatchObject({ receiptDate: "2026-06-05", receiptDateCalendar: "gregory" });
    expect(stored.reviewReasons).toEqual(["date_ambiguous"]);
  });

  it("ignores a due date and a fiscal-year token when deciding the date", () => {
    const dates = [
      printed("FY 2082/83"),
      printed("15/07/2082", "Miti"),
      { ...printed("30/08/2082", "Due Date"), role: "other" as const },
    ];
    expect(storedExtraction(reply({ dates }), UPLOAD_DAY).receiptDate).toBe("2025-11-01");
  });

  it("adds a reason for each of merchant, total and currency the model couldn't read", () => {
    const stored = storedExtraction(
      reply({ merchant: null, total: null, currency: null }),
      UPLOAD_DAY,
    );
    expect(stored).toMatchObject({ merchant: null, total: null, currency: null });
    expect(stored.reviewReasons).toEqual(["no_merchant", "no_total", "no_currency"]);
  });

  it("drops a bill number that is the seller's PAN, whatever its spacing", () => {
    const stored = storedExtraction(
      reply({ invoiceNumber: "999 000 001", merchantTaxId: "999000001" }),
      UPLOAD_DAY,
    );
    expect(stored.invoiceNumber).toBeNull();
    expect(stored.merchantTaxId).toBe("999000001");
  });

  it("keeps a bill number with prefixes and a fiscal-year part as printed", () => {
    const stored = storedExtraction(reply({ invoiceNumber: " SI-0042-82/83 " }), UPLOAD_DAY);
    expect(stored.invoiceNumber).toBe("SI-0042-82/83");
  });

  it("balances service charge plus VAT, and flags a total that doesn't", () => {
    expect(storedExtraction(reply(), UPLOAD_DAY).reviewReasons).toEqual([]);
    expect(storedExtraction(reply({ serviceCharge: null }), UPLOAD_DAY).reviewReasons).toEqual([
      "totals_mismatch",
    ]);
  });

  it("accepts a total rounded to the rupee", () => {
    const stored = storedExtraction(reply({ tax: 143.4, total: 1243 }), UPLOAD_DAY);
    expect(stored.reviewReasons).toEqual([]);
  });

  it("stores a signed discount as a positive amount", () => {
    const stored = storedExtraction(
      reply({ discount: -50, serviceCharge: null, tax: null, total: 950 }),
      UPLOAD_DAY,
    );
    expect(stored.discount).toBe("50");
    expect(stored.reviewReasons).toEqual([]);
  });

  it("numbers items in printed order", () => {
    const stored = storedExtraction(reply(), UPLOAD_DAY);
    expect(stored.items.map((item) => [item.position, item.name])).toEqual([
      [0, "Buff Momo"],
      [1, "Masala Tea"],
    ]);
  });

  it("reads a v2 reply, with no printed dates, from the model's AD reading", () => {
    const v2: ReceiptExtraction = {
      merchant: "Blue Door Bistro",
      receiptDate: "2026-10-21",
      category: "Meals",
      currency: "USD",
      subtotal: 10,
      tax: 1,
      tip: null,
      total: 11,
      confidence: 0.95,
      items: [],
    };
    const stored = storedExtraction(v2, UPLOAD_DAY);
    expect(stored).toMatchObject({
      receiptDate: "2026-10-21",
      receiptDateCalendar: null,
      invoiceNumber: null,
      discount: null,
      reviewReasons: [],
    });
  });

  it("drops a date after the upload day", () => {
    const stored = storedExtraction(reply({ dates: [printed("11/20/2026", "Date")] }), UPLOAD_DAY);
    expect(stored.receiptDate).toBeNull();
    expect(stored.reviewReasons).toEqual(["date_implausible"]);
  });
});
