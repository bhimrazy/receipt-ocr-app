import { describe, expect, it } from "vitest";
import { canEditReceipt } from "@/lib/receipt-permissions";

const own = { userId: "u1" };
const other = { userId: "u2" };

describe("canEditReceipt", () => {
  it("lets owners and admins change any receipt", () => {
    expect(canEditReceipt({ userId: "u1", role: "owner" }, other)).toBe(true);
    expect(canEditReceipt({ userId: "u1", role: "admin" }, other)).toBe(true);
    expect(canEditReceipt({ userId: "u1", role: "member,admin" }, other)).toBe(true);
  });

  it("limits members to their own receipts", () => {
    expect(canEditReceipt({ userId: "u1", role: "member" }, own)).toBe(true);
    expect(canEditReceipt({ userId: "u1", role: "member" }, other)).toBe(false);
  });

  it("leaves a receipt whose uploader was deleted to owners and admins", () => {
    expect(canEditReceipt({ userId: "u1", role: "member" }, { userId: null })).toBe(false);
    expect(canEditReceipt({ userId: "u1", role: "owner" }, { userId: null })).toBe(true);
  });
});
