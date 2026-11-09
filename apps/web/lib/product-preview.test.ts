import { describe, expect, it } from "vitest";
import { previewTotals } from "./product-preview";

describe("previewTotals", () => {
  it("adds the line prices and 8% tax to the cent", () => {
    expect(previewTotals([2.49, 9.98, 5.49, 6.79, 11.97])).toEqual({
      subtotal: 36.72,
      tax: 2.94,
      total: 39.66,
    });
  });

  it("does not drift on prices that aren't exact in binary", () => {
    expect(previewTotals([0.1, 0.2]).subtotal).toBe(0.3);
  });
});
