import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CATEGORY_DESCRIPTIONS,
  normalizeCategory,
  parseCategory,
  RECEIPT_CATEGORIES,
} from "./categories";

describe("RECEIPT_CATEGORIES", () => {
  it("has no duplicates and an Other bucket so the model always has a valid answer", () => {
    expect(new Set(RECEIPT_CATEGORIES).size).toBe(RECEIPT_CATEGORIES.length);
    expect(RECEIPT_CATEGORIES).toContain("Other");
  });

  it("describes every category for the prompt", () => {
    for (const category of RECEIPT_CATEGORIES) {
      expect(CATEGORY_DESCRIPTIONS[category]).toBeTruthy();
    }
  });
});

describe("normalizeCategory", () => {
  it("maps the old consumer list and stored free text onto canonical values", () => {
    expect(normalizeCategory("Grocery")).toBe("Groceries");
    expect(normalizeCategory("Groceries")).toBe("Groceries");
    expect(normalizeCategory("Restaurant")).toBe("Meals");
    expect(normalizeCategory("Gas")).toBe("Fuel");
    expect(normalizeCategory("Fuel")).toBe("Fuel");
    expect(normalizeCategory("office")).toBe("Office");
    expect(normalizeCategory("  SHOPPING ")).toBe("Supplies");
  });

  it("buckets unknown text as Other and keeps empty values null", () => {
    expect(normalizeCategory("Llama grooming")).toBe("Other");
    expect(normalizeCategory("")).toBeNull();
    expect(normalizeCategory("   ")).toBeNull();
    expect(normalizeCategory(null)).toBeNull();
  });

  it("parseCategory rejects unknown text instead of bucketing it", () => {
    expect(parseCategory("Meals")).toBe("Meals");
    expect(parseCategory("dining")).toBe("Meals");
    expect(parseCategory("Llama grooming")).toBeUndefined();
  });
});

describe("0004_canonical_categories.sql backfill", () => {
  const sql = readFileSync(
    new URL("../../../apps/web/drizzle/0004_canonical_categories.sql", import.meta.url),
    "utf8",
  );
  const pairs = [...sql.matchAll(/WHEN '([^']+)' THEN '([^']+)'/g)].map(([, from, to]) => [
    from!,
    to!,
  ]);

  it("maps exactly like parseCategory, so old rows match new writes", () => {
    expect(pairs.length).toBeGreaterThan(RECEIPT_CATEGORIES.length);
    for (const [from, to] of pairs) {
      expect(parseCategory(from), from).toBe(to);
    }
  });

  it("covers every canonical value, so they are kept as-is", () => {
    const sources = new Set(pairs.map(([from]) => from));
    for (const category of RECEIPT_CATEGORIES) {
      expect(sources.has(category.toLowerCase()), category).toBe(true);
    }
  });
});
