import { describe, expect, it } from "vitest";
import { RECEIPT_CATEGORIES } from "./categories";

describe("RECEIPT_CATEGORIES", () => {
  it("has no duplicates", () => {
    expect(new Set(RECEIPT_CATEGORIES).size).toBe(RECEIPT_CATEGORIES.length);
  });

  it("includes an Other bucket so the model always has a valid answer", () => {
    // Without a catch-all, structured generation fails on anything unusual.
    expect(RECEIPT_CATEGORIES).toContain("Other");
  });

  it("pins the exact set, because these values are already stored in rows", () => {
    // Renaming or dropping one silently orphans every receipt categorised
    // with the old value, and breaks the history filter for them.
    expect([...RECEIPT_CATEGORIES]).toEqual([
      "Grocery",
      "Restaurant",
      "Gas",
      "Pharmacy",
      "Shopping",
      "Travel",
      "Utilities",
      "Entertainment",
      "Services",
      "Other",
    ]);
  });
});
