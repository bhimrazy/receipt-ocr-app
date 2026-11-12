import type { ReceiptExportRow, ReceiptWithItems } from "@receipt-ocr/core";
import { describe, expect, it } from "vitest";
import { csvFilename, receiptItemsToCsv, receiptsToCsv } from "./csv";

function receipt(overrides: Partial<ReceiptWithItems> = {}): ReceiptWithItems {
  return {
    id: "r1",
    organizationId: "org1",
    userId: "u1",
    merchant: "Corner Store",
    receiptDate: "2026-08-01",
    category: "Groceries",
    currency: "USD",
    subtotal: "10.00",
    tax: "1.00",
    tip: null,
    discount: null,
    serviceCharge: null,
    invoiceNumber: null,
    merchantTaxId: null,
    receiptDateCalendar: null,
    reviewReasons: [],
    total: "11.00",
    confidence: "0.9500",
    status: "completed",
    fileName: "corner.jpg",
    imageObjectKey: null,
    storageSource: "managed",
    attempts: 1,
    lastAttemptAt: null,
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

function row(overrides: Partial<ReceiptExportRow> = {}): ReceiptExportRow {
  return {
    id: "r1",
    status: "completed",
    merchant: "Corner Store",
    receiptDate: "2026-08-01",
    category: "Groceries",
    currency: "USD",
    subtotal: "10.00",
    tax: "1.00",
    tip: null,
    discount: null,
    serviceCharge: null,
    invoiceNumber: null,
    merchantTaxId: null,
    receiptDateCalendar: null,
    reviewReasons: [],
    total: "11.00",
    confidence: 0.95,
    fileName: "corner.jpg",
    errorMessage: null,
    itemCount: 1,
    groups: [],
    userId: null,
    reviewedAt: null,
    createdAt: new Date("2026-08-01T10:00:00Z"),
    ...overrides,
  };
}

describe("receiptsToCsv", () => {
  it("emits a header plus one row per receipt", () => {
    const lines = receiptsToCsv([row(), row({ id: "r2" })])
      .trimEnd()
      .split("\n");
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain("receipt_id");
    expect(lines[1]).toContain("Corner Store");
  });

  it("renders null fields as empty cells rather than the string 'null'", () => {
    const csv = receiptsToCsv([row({ tip: null, merchant: null })]);
    expect(csv).not.toContain("null");
  });

  it("quotes cells containing commas, quotes, or newlines", () => {
    const csv = receiptsToCsv([row({ merchant: 'Bob, "The Grocer"' })]);
    expect(csv).toContain('"Bob, ""The Grocer"""');
  });

  it("neutralises formula injection from OCR'd merchant names", () => {
    // A cell starting with = + - or @ is executed by Excel and Sheets, and
    // merchant names come straight out of an untrusted image.
    for (const dangerous of ["=1+1", "+1", "-1+A1", "@SUM(A1)"]) {
      const csv = receiptsToCsv([row({ merchant: dangerous })]);
      expect(csv).toContain(`'${dangerous}`);
    }
  });

  it("lists the receipt's groups in one cell, guarded like any other text", () => {
    const [header, line] = receiptsToCsv([row({ groups: ["Berlin trip", "=Taxes, 2026"] })])
      .trimEnd()
      .split("\n");
    const columns = header!.split(",");
    expect(columns[columns.indexOf("items") + 1]).toBe("groups");
    expect(line).toContain(`"Berlin trip; '=Taxes, 2026"`);
    expect(receiptsToCsv([row({ groups: ["=SUM(A1)"] })])).toContain("'=SUM(A1)");
  });

  it("adds the BS date, dotted, only for a receipt that printed Bikram Sambat", () => {
    const csv = receiptsToCsv([
      row({ receiptDate: "2023-07-25", receiptDateCalendar: "bikram-sambat" }),
      row({ receiptDate: "2023-07-25", receiptDateCalendar: "gregory" }),
    ]);
    const [header, bs, ad] = csv.trimEnd().split("\n");
    const at = header!.split(",").indexOf("receipt_date_bs");
    expect(at).toBe(header!.split(",").indexOf("receipt_date") + 1);
    expect(bs!.split(",")[at]).toBe("2080.04.09");
    expect(ad!.split(",")[at]).toBe("");
  });

  it("exports the bill number, tax ID, discount, service charge and review reasons", () => {
    const csv = receiptsToCsv([
      row({
        invoiceNumber: "-80/81",
        merchantTaxId: "601234567",
        discount: "5.00",
        serviceCharge: "10.00",
        reviewReasons: ["no_date", "totals_mismatch"],
      }),
    ]);
    const [header, line] = csv.trimEnd().split("\n");
    const value = (name: string) => line!.split(",")[header!.split(",").indexOf(name)];
    expect(value("invoice_number")).toBe("'-80/81");
    expect(value("merchant_tax_id")).toBe("601234567");
    expect(value("discount")).toBe("5.00");
    expect(value("service_charge")).toBe("10.00");
    expect(value("review_reasons")).toBe("no_date; totals_mismatch");
  });

  it("leaves negative amounts numeric so refunds still add up (L7)", () => {
    const csv = receiptsToCsv([row({ total: "-5.00", tax: "-0.40" })]);
    expect(csv).toContain(",-5.00,");
    expect(csv).not.toContain("'-5.00");
  });
});

describe("receiptItemsToCsv", () => {
  it("includes every line item and the totals rows", () => {
    const csv = receiptItemsToCsv(receipt());
    expect(csv).toContain("Milk");
    for (const label of ["Subtotal", "Discount", "Service charge", "Tax", "Tip", "Total"]) {
      expect(csv).toContain(label);
    }
  });

  it("carries the BS date on every row of a BS receipt", () => {
    const lines = receiptItemsToCsv(
      receipt({ receiptDate: "2023-07-25", receiptDateCalendar: "bikram-sambat" }),
    )
      .trimEnd()
      .split("\n");
    expect(lines[0]).toMatch(/^receipt_id,merchant,receipt_date,receipt_date_bs,item,/);
    for (const line of lines.slice(1)) expect(line).toContain(",2023-07-25,2080.04.09,");
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
