import { describe, expect, it } from "vitest";
import { isContentError, scrubMessage, scrubUrl } from "./scrub";

describe("scrubUrl", () => {
  it("drops query strings and hashes and keeps the origin", () => {
    expect(scrubUrl("https://receipt-ocr.example/app?redirect=/x#y")).toBe(
      "https://receipt-ocr.example/app",
    );
    expect(scrubUrl("/sign-in?email=jane@example.com")).toBe("/sign-in");
  });

  it("replaces bearer secrets and record ids in paths (security plan B5)", () => {
    expect(scrubUrl("/api/auth/reset-password/abcDEF123?callbackURL=/reset-password")).toBe(
      "/api/auth/reset-password/:token",
    );
    expect(scrubUrl("https://h.example/reset-password/tok123")).toBe(
      "https://h.example/reset-password/:token",
    );
    expect(scrubUrl("/accept-invitation/inv_9f8e7d")).toBe("/accept-invitation/:id");
    expect(scrubUrl("/app/receipts/0f8fad5b-d9cb-469f-a165-70867728950e/edit")).toBe(
      "/app/receipts/:id/edit",
    );
  });
});

describe("scrubMessage", () => {
  it("cuts Drizzle params and AI SDK payloads (security plan B1 and B6)", () => {
    expect(scrubMessage("Failed query: select * from member params: a@b.com,Bhim")).toBe(
      "Failed query: select * from member [redacted]",
    );
    const ai = scrubMessage('Type validation failed: Value: {"merchant":"Dr Smith Clinic"}');
    expect(ai).not.toContain("Dr Smith");
    expect(scrubMessage('JSON parsing failed: Text: {"total": 9.5')).not.toContain("9.5");
  });

  it("masks emails, credentials, long numbers and URL queries, and caps length", () => {
    const text = scrubMessage(
      "user jane@example.com sent Bearer xaat-123 card 4111111111111111 from https://h.example/a?t=1",
    );
    expect(text).not.toMatch(/jane|xaat|4111|t=1/);
    expect(scrubMessage("x".repeat(500)).length).toBeLessThanOrEqual(201);
  });
});

describe("isContentError", () => {
  it("matches the AI SDK errors that carry receipt data", () => {
    expect(isContentError("AI_NoObjectGeneratedError")).toBe(true);
    expect(isContentError("AI_APICallError")).toBe(true);
    expect(isContentError("TypeError")).toBe(false);
    expect(isContentError(undefined)).toBe(false);
  });
});
