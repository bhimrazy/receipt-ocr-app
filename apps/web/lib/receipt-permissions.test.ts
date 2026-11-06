import { describe, expect, it } from "vitest";
import { canEditReceipt } from "./receipt-permissions";

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
});
