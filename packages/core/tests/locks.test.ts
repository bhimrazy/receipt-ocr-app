import { describe, expect, it } from "vitest";
import { LOCK_NAMESPACES } from "../src/locks";

describe("LOCK_NAMESPACES", () => {
  it("gives every lock its own namespace", () => {
    const values = Object.values(LOCK_NAMESPACES);
    expect(new Set(values).size).toBe(values.length);
  });

  it("keeps namespaces within int4, the two-key lock's argument type", () => {
    for (const value of Object.values(LOCK_NAMESPACES)) {
      expect(Number.isInteger(value) && value > 0 && value <= 2_147_483_647).toBe(true);
    }
  });
});
