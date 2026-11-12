import type { ReceiptWithItems } from "@receipt-ocr/core";
import { describe, expect, it } from "vitest";
import { checksFor, totalsMismatch } from "./receipt-checks";

type Parts = Partial<Pick<ReceiptWithItems, "subtotal" | "tax" | "tip" | "total">> & {
  lines?: string[];
};

const receipt = ({ lines = [], ...fields }: Parts) =>
  ({
    confidence: "0.98",
    imageObjectKey: "r.jpg",
    merchant: "Test Shop",
    receiptDate: "2026-11-01",
    subtotal: null,
    tax: null,
    tip: null,
    total: null,
    ...fields,
    items: lines.map((totalPrice) => ({ totalPrice, confidence: "0.99" })),
  }) as unknown as ReceiptWithItems;

describe("totalsMismatch", () => {
  it("accepts prices that already include tax: total equals the line sum or the subtotal", () => {
    expect(totalsMismatch(receipt({ lines: ["10.00", "5.00"], tax: "1.36", total: "15.00" }))).toBe(
      null,
    );
    expect(totalsMismatch(receipt({ subtotal: "15.00", tax: "1.36", total: "15.00" }))).toBe(null);
    expect(
      totalsMismatch(
        receipt({ lines: ["10.00", "5.00"], tax: "1.36", tip: "2.00", total: "17.00" }),
      ),
    ).toBe(null);
  });

  it("counts negative lines as discounts", () => {
    expect(
      totalsMismatch(receipt({ lines: ["10.00", "5.00", "-2.50"], tax: "1.00", total: "13.50" })),
    ).toBe(null);
    expect(totalsMismatch(receipt({ lines: ["10.00", "-2.50"], total: "7.50" }))).toBe(null);
  });

  it("accepts tax and tip added on top", () => {
    expect(
      totalsMismatch(receipt({ subtotal: "20.00", tax: "1.60", tip: "3.00", total: "24.60" })),
    ).toBe(null);
  });

  it("flags a real mismatch with the sum it expected", () => {
    expect(totalsMismatch(receipt({ lines: ["10.00", "5.00"], tax: "1.20", total: "19.99" }))).toBe(
      16.2,
    );
    expect(totalsMismatch(receipt({ subtotal: "20.00", tax: "1.60", total: "30.00" }))).toBe(21.6);
  });

  it("has nothing to compare without a total or any amounts", () => {
    expect(totalsMismatch(receipt({ lines: ["1.00"] }))).toBe(null);
    expect(totalsMismatch(receipt({ total: "5.00" }))).toBe(null);
  });
});

describe("checksFor", () => {
  const money = (value: string | null) => (value === null ? null : `$${value}`);

  it("explains a mismatch in plain words", () => {
    const checks = checksFor(receipt({ lines: ["10.00"], total: "12.00" }), money);
    expect(checks).toEqual([
      "The amounts add up to $10.00, but the total says $12.00. A discount, a coupon or tax already included in the prices often explains this.",
    ]);
  });

  it("is empty for a clean receipt", () => {
    expect(checksFor(receipt({ lines: ["10.00"], total: "10.00" }), money)).toEqual([]);
  });
});
