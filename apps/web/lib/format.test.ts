import { describe, expect, it } from "vitest";
import { money, pct } from "./format";

describe("money", () => {
  it("formats decimal strings from numeric columns", () => {
    expect(money("11.00")).toBe("$11.00");
    expect(money(11)).toBe("$11.00");
  });

  it("honours the currency", () => {
    expect(money("11.00", "EUR")).toContain("11.00");
  });

  it("treats null, undefined, and unparseable values as zero", () => {
    expect(money(null)).toBe("$0.00");
    expect(money(undefined)).toBe("$0.00");
    expect(money("not a number")).toBe("$0.00");
  });
});

describe("pct", () => {
  it("renders a 0–1 confidence as a percentage", () => {
    expect(pct("0.9500")).toBe("95%");
    expect(pct(1)).toBe("100%");
    expect(pct(0)).toBe("0%");
  });

  it("treats missing confidence as zero", () => {
    expect(pct(null)).toBe("0%");
    expect(pct(undefined)).toBe("0%");
  });
});
