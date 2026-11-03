import { describe, expect, it } from "vitest";
import { extractReceipt } from "./extract";
import { FIXTURE_FAIL_MARKER, FIXTURE_RECEIPTS } from "./fixture";
import { receiptExtractionSchema } from "./schema";

const file = (text: string) => ({ data: new TextEncoder().encode(text), mediaType: "image/jpeg" });

describe("extractReceipt with the fixture provider", () => {
  it("is deterministic: same bytes, same receipt", async () => {
    const a = await extractReceipt({ model: "fixture", file: file("receipt-1") });
    const b = await extractReceipt({ model: "fixture", file: file("receipt-1") });
    expect(a).toEqual(b);
    expect(FIXTURE_RECEIPTS).toContainEqual(a.extraction);
  });

  it("returns extractions that satisfy the schema the real provider is held to", async () => {
    for (const fixture of FIXTURE_RECEIPTS) {
      expect(receiptExtractionSchema.safeParse(fixture).success).toBe(true);
    }
    const { usage, model } = await extractReceipt({ model: "fixture", file: file("x") });
    expect(model).toBe("fixture");
    expect(usage.totalTokens).toBe(0);
  });

  it("fails on demand, to exercise the failure path end to end", async () => {
    await expect(
      extractReceipt({ model: "fixture", file: file(`a ${FIXTURE_FAIL_MARKER} b`) }),
    ).rejects.toThrow(/simulated/);
  });
});
