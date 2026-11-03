import { describe, expect, it } from "vitest";
import { itemsF1, percentile, scoreReceipt, similarity } from "./score";

const truth = {
  merchant: "Warung Makan Bahagia",
  receiptDate: "2026-10-02",
  category: "Restaurant",
  currency: "IDR",
  total: 155100,
  tax: 14100,
  tip: null,
  items: [
    { name: "Nasi Goreng", totalPrice: 62000 },
    { name: "Es Teh Manis", totalPrice: 24000 },
  ],
};

describe("scoreReceipt", () => {
  it("passes an exact match", () => {
    const scores = scoreReceipt(truth, { ...truth, merchant: "WARUNG MAKAN BAHAGIA" });
    expect(Object.values(scores).every((v) => v === 1)).toBe(true);
  });

  it("fails the locale-separator misread (31.000 read as 31.00) on amounts", () => {
    const scores = scoreReceipt(truth, { ...truth, total: 155.1, tax: 14.1 });
    expect(scores.total).toBe(0);
    expect(scores.tax).toBe(0);
  });

  it("allows 0.01 on totals but no more", () => {
    expect(scoreReceipt({ total: 10 }, { total: 10.01 }).total).toBe(1);
    expect(scoreReceipt({ total: 10 }, { total: 10.03 }).total).toBe(0);
  });

  it("treats a missing tip and a zero tip as the same", () => {
    expect(scoreReceipt({ tip: null }, { tip: 0 }).tip).toBe(1);
    expect(scoreReceipt({ tip: null }, { tip: 3 }).tip).toBe(0);
  });

  it("skips fields the ground truth does not state", () => {
    expect(Object.keys(scoreReceipt({ currency: "USD" }, { currency: "USD", total: 5 }))).toEqual([
      "currency",
    ]);
  });
});

describe("itemsF1", () => {
  it("needs the price to match as well as the name", () => {
    const wrongPrice = [truth.items[0]!, { name: "Es Teh Manis", totalPrice: 24 }];
    expect(itemsF1(truth.items, wrongPrice)).toBeCloseTo(0.5);
  });

  it("penalises extra items", () => {
    expect(itemsF1(truth.items, [...truth.items, { name: "Ghost", totalPrice: 1 }])).toBeCloseTo(
      0.8,
    );
  });
});

describe("helpers", () => {
  it("similarity ignores case and punctuation", () => {
    expect(similarity("Blue Door Bistro", "blue-door bistro!")).toBe(1);
  });

  it("percentile uses nearest rank", () => {
    expect(percentile([1, 2, 3, 4, 100], 50)).toBe(3);
    expect(percentile([1, 2, 3, 4, 100], 95)).toBe(100);
  });
});
