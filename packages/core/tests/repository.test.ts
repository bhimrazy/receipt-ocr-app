import { OCR_FAILURE_KINDS } from "@receipt-ocr/ai";
import { OCR_CALL_STATUSES } from "@receipt-ocr/db";
import { describe, expect, it } from "vitest";
import { canManageAnyReceipt, isReceiptId } from "../src/repository";

describe("OCR_CALL_STATUSES", () => {
  it("is the CHECK constraint's list: ok, every AI failure kind, and storage-error", () => {
    expect([...OCR_CALL_STATUSES].sort()).toEqual(
      ["ok", ...OCR_FAILURE_KINDS, "storage-error"].sort(),
    );
  });
});

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
