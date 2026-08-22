import type { ReceiptWithItems } from "@receipt-ocr/core";
import { describe, expect, it } from "vitest";
import { csvFilename, receiptItemsToCsv, receiptsToCsv } from "./csv";

function receipt(overrides: Partial<ReceiptWithItems> = {}): ReceiptWithItems {
  return {
    id: "r1",
    organizationId: "org1",
    userId: "u1",
    merchant: "Corner Store",
    receiptDate: "2026-08-01",
    category: "Grocery",
    currency: "USD",
    subtotal: "10.00",
    tax: "1.00",
    tip: null,
    total: "11.00",
    confidence: "0.9500",
    status: "completed",
    imageObjectKey: null,
    storageSource: "managed",
    rawJson: null,
    errorMessage: null,
    createdAt: new Date("2026-08-01T10:00:00Z"),
    updatedAt: new Date("2026-08-01T10:00:00Z"),
    items: [
      {
        id: "i1",
        receiptId: "r1",
        name: "Milk",
        quantity: 2,
        unitPrice: "2.50",
        totalPrice: "5.00",
        confidence: "0.99",
      },
    ],
    ...overrides,
  } as ReceiptWithItems;
}

describe("receiptsToCsv", () => {
  it("emits a header plus one row per receipt", () => {
    const lines = receiptsToCsv([receipt(), receipt({ id: "r2" })]).trimEnd().split("\n");
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain("receipt_id");
    expect(lines[1]).toContain("Corner Store");
  });

  it("renders null fields as empty cells rather than the string 'null'", () => {
    const csv = receiptsToCsv([receipt({ tip: null, merchant: null })]);
    expect(csv).not.toContain("null");
  });

  it("quotes cells containing commas, quotes, or newlines", () => {
    const csv = receiptsToCsv([receipt({ merchant: 'Bob, "The Grocer"' })]);
    expect(csv).toContain('"Bob, ""The Grocer"""');
  });

  it("neutralises formula injection from OCR'd merchant names", () => {
    // A cell starting with = + - or @ is executed by Excel and Sheets, and
    // merchant names come straight out of an untrusted image.
    for (const dangerous of ["=1+1", "+1", "-1", "@SUM(A1)"]) {
      const csv = receiptsToCsv([receipt({ merchant: dangerous })]);
      expect(csv).toContain(`'${dangerous}`);
    }
  });
});

describe("receiptItemsToCsv", () => {
  it("includes every line item and the totals rows", () => {
    const csv = receiptItemsToCsv(receipt());
    expect(csv).toContain("Milk");
    for (const label of ["Subtotal", "Tax", "Tip", "Total"]) {
      expect(csv).toContain(label);
    }
  });

  it("still emits totals when there are no line items", () => {
    const csv = receiptItemsToCsv(receipt({ items: [] }));
    expect(csv).toContain("Total");
  });
});

describe("csvFilename", () => {
  it("slugifies the label and appends the date", () => {
    expect(csvFilename("receipt", "Bob's Corner Store!")).toMatch(
      /^receipt-bob-s-corner-store-\d{4}-\d{2}-\d{2}\.csv$/,
    );
  });

  it("omits the slug when there is no usable label", () => {
    expect(csvFilename("receipts", null)).toMatch(/^receipts-\d{4}-\d{2}-\d{2}\.csv$/);
    expect(csvFilename("receipts", "!!!")).toMatch(/^receipts-\d{4}-\d{2}-\d{2}\.csv$/);
  });
});
