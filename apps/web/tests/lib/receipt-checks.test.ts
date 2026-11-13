import type { ReceiptWithItems } from "@receipt-ocr/core";
import { describe, expect, it } from "vitest";
import { checksFor } from "@/lib/receipt-checks";

const receipt = (fields: Partial<ReceiptWithItems> & { lines?: string[] }) => {
  const { lines = [], ...rest } = fields;
  return {
    confidence: "0.98",
    currency: "USD",
    imageObjectKey: "r.jpg",
    merchant: "Test Shop",
    receiptDate: "2026-11-01",
    reviewReasons: [],
    subtotal: null,
    tax: null,
    tip: null,
    discount: null,
    serviceCharge: null,
    total: null,
    ...rest,
    items: lines.map((totalPrice) => ({ totalPrice, confidence: "0.99" })),
  } as unknown as ReceiptWithItems;
};

const money = (value: string | null) => (value === null ? null : `$${value}`);

describe("checksFor", () => {
  it("is empty when no check failed, whatever the confidence", () => {
    expect(
      checksFor(receipt({ confidence: "0.5", lines: ["10.00"], total: "12.00" }), money),
    ).toEqual([]);
  });

  it("explains a totals mismatch with the sum it expected", () => {
    const checks = checksFor(
      receipt({ reviewReasons: ["totals_mismatch"], lines: ["10.00"], total: "12.00" }),
      money,
    );
    expect(checks).toEqual([
      "The amounts add up to $10.00, but the total says $12.00. Rounding can explain a small gap; otherwise check the numbers against the photo.",
    ]);
  });

  it("names the file a PDF was uploaded as, and keeps unknown reasons visible", () => {
    expect(
      checksFor(
        receipt({ imageObjectKey: "r.pdf", reviewReasons: ["date_conflict", "something_new"] }),
        money,
      ),
    ).toEqual([
      "The dates printed on the receipt don't agree. Check the date against the PDF.",
      "Something on this receipt needs a check. Compare it with the PDF.",
    ]);
  });

  it("explains the legacy low-confidence flag with the score", () => {
    expect(
      checksFor(receipt({ confidence: "0.62", reviewReasons: ["low_confidence"] }), money),
    ).toEqual(["Overall confidence is 62%. Compare the merchant, date and total with the photo."]);
  });
});
