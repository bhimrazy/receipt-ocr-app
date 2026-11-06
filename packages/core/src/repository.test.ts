import { describe, expect, it } from "vitest";
import { canManageAnyReceipt, isReceiptId } from "./repository";

describe("canManageAnyReceipt (P2-5)", () => {
  it.each([
    ["owner", true],
    ["admin", true],
    ["member,admin", true],
    ["member", false],
    ["", false],
    [undefined, false],
    ["owner-ish", false],
  ])("%s → %s", (role, expected) => {
    expect(canManageAnyReceipt(role)).toBe(expected);
  });
});

describe("isReceiptId (L3)", () => {
  it("accepts UUIDs and rejects anything else", () => {
    expect(isReceiptId("0f8fad5b-d9cb-469f-a165-70867728950e")).toBe(true);
    for (const id of ["not-a-uuid", "", "0f8fad5b-d9cb-469f-a165-70867728950e'--", "1"]) {
      expect(isReceiptId(id)).toBe(false);
    }
  });
});
