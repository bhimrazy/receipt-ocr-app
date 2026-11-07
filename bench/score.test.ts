import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { RECEIPT_CATEGORIES } from "@receipt-ocr/ai/categories";
import { describe, expect, it } from "vitest";
import { itemsF1, percentile, scoreReceipt, similarity, type Receipt } from "./score";

const truth = {
  merchant: "Warung Makan Bahagia",
  receiptDate: "2026-10-02",
  category: "Meals",
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

describe("category scoring", () => {
  it("accepts any of several listed categories", () => {
    const either = { ...truth, category: ["Equipment", "Supplies"] };
    expect(scoreReceipt(either, { ...truth, category: "Supplies" }).category).toBe(1);
    expect(scoreReceipt(either, { ...truth, category: "Equipment" }).category).toBe(1);
    expect(scoreReceipt(either, { ...truth, category: "Office" }).category).toBe(0);
  });

  it("reads a legacy label in the ground truth as the app's canonical category", () => {
    // The 2026-11-07 run scored 0% here: "Restaurant" can never equal the schema's "Meals".
    expect(scoreReceipt({ ...truth, category: "Restaurant" }, truth).category).toBe(1);
  });
});

describe("bench fixtures", () => {
  const dir = path.join(import.meta.dirname, "fixtures");
  const truths = readdirSync(dir)
    .filter((file) => file.endsWith(".json"))
    .map(
      (file) => [file, JSON.parse(readFileSync(path.join(dir, file), "utf8")) as Receipt] as const,
    );

  it("exist", () => {
    expect(truths.length).toBeGreaterThan(0);
  });

  it.each(truths)("%s uses only categories the extraction schema can produce", (_, receipt) => {
    if (receipt.category == null) return;
    const accepted = Array.isArray(receipt.category) ? receipt.category : [receipt.category];
    expect(accepted.length).toBeGreaterThan(0);
    for (const category of accepted) expect(RECEIPT_CATEGORIES).toContain(category);
  });
});

describe("merchant scoring", () => {
  it("keeps Devanagari vowel signs, so a different name doesn't pass as the same", () => {
    const name = "भाटभटेनी सुपरमार्केट";
    expect(similarity(name, name)).toBe(1);
    // Only the vowel signs differ; with marks stripped these compared as identical.
    expect(similarity(name, "भटभटन सपरमरकट")).toBeLessThan(0.8);
  });

  it("treats composed and decomposed accents as the same letter", () => {
    const composed = "Bäckerei Sonnenschein";
    expect(similarity(composed, composed.normalize("NFD"))).toBe(1);
    expect(similarity("Café Mozart", "CAFÉ MOZART")).toBe(1);
  });

  it("accepts any of several spellings", () => {
    const truthNames = {
      ...truth,
      merchant: ["Bhat-Bhateni Super Market", "Bhatbhateni Supermarket"],
    };
    expect(
      scoreReceipt(truthNames, { ...truth, merchant: "BHATBHATENI SUPERMARKET" }).merchant,
    ).toBe(1);
    expect(
      scoreReceipt(truthNames, { ...truth, merchant: "Bhat Bhateni Super Market" }).merchant,
    ).toBe(1);
    expect(scoreReceipt(truthNames, { ...truth, merchant: "Salesberry" }).merchant).toBe(0);
  });
});
