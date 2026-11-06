import { describe, expect, it } from "vitest";
import { costOf, OCR_MODELS, priceAt, priceCall, type ExtractionUsage } from "./models";

const usage = (u: Partial<ExtractionUsage>): ExtractionUsage => ({
  inputTokens: null,
  cachedInputTokens: null,
  cacheWriteTokens: null,
  outputTokens: null,
  reasoningTokens: null,
  ...u,
});
const day = (iso: string) => new Date(`${iso}T12:00:00Z`);

describe("costOf", () => {
  it("prices input and output per token in micro-USD", () => {
    // 2000 × 0.75 + 500 × 3.75 = 1500 + 1875
    const cost = costOf(
      "google:gemini-3.8-flash",
      usage({ inputTokens: 2000, outputTokens: 500 }),
      day("2026-11-06"),
    );
    expect(cost).toEqual({ microUsd: 3375, priceFrom: "2026-11-06" });
  });

  it("does not add reasoning on top of output, which already includes it", () => {
    const without = costOf(
      "google:gemini-3.8-flash",
      usage({ inputTokens: 1000, outputTokens: 800 }),
      day("2026-11-06"),
    );
    const withReasoning = costOf(
      "google:gemini-3.8-flash",
      usage({ inputTokens: 1000, outputTokens: 800, reasoningTokens: 600 }),
      day("2026-11-06"),
    );
    expect(withReasoning).toEqual(without);
  });

  it("charges cached input at the cache rate, out of the input total", () => {
    // (1000 − 400) × 0.30 + 400 × 0.03 + 100 × 2.50 = 180 + 12 + 250
    const cost = costOf(
      "google:gemini-3.5-flash-lite",
      usage({ inputTokens: 1000, cachedInputTokens: 400, outputTokens: 100 }),
      day("2026-11-20"),
    );
    expect(cost.microUsd).toBe(442);
  });

  it("charges cache writes at their own rate, or as input when the model has none", () => {
    const u = usage({
      inputTokens: 1000,
      cachedInputTokens: 200,
      cacheWriteTokens: 300,
      outputTokens: 0,
    });
    // 500 × 1.00 + 200 × 0.10 + 300 × 1.25
    expect(
      priceCall(
        { from: "2026-01-01", input: 1, cachedInput: 0.1, cacheWrite: 1.25, output: 5 },
        {
          ...u,
          inputTokens: 1000,
          outputTokens: 0,
        },
      ),
    ).toBe(895);
    // Gemini has no write price: the written 300 cost the input rate, 800 × 0.30 + 200 × 0.03.
    expect(costOf("google:gemini-3.5-flash-lite", u, day("2026-11-20")).microUsd).toBe(246);
  });

  it("switches to the new price on its first UTC day", () => {
    const u = usage({ inputTokens: 1000, outputTokens: 1000 });
    expect(costOf("google:gemini-3.8-flash", u, new Date("2026-12-31T23:59:59Z"))).toEqual({
      microUsd: 4500,
      priceFrom: "2026-11-06",
    });
    expect(costOf("google:gemini-3.8-flash", u, new Date("2027-01-01T00:00:00Z"))).toEqual({
      microUsd: 9000,
      priceFrom: "2027-01-01",
    });
  });

  it("rounds once to whole micro-USD", () => {
    // 3 × 0.075 + 1 × 3.75 = 3.975 (all cached)
    const cost = costOf(
      "google:gemini-3.8-flash",
      usage({ inputTokens: 3, cachedInputTokens: 3, outputTokens: 1 }),
      day("2026-11-06"),
    );
    expect(cost.microUsd).toBe(4);
  });

  it("is null, not zero, when tokens, model or price are unknown", () => {
    const none = { microUsd: null, priceFrom: null };
    const at = day("2026-11-06");
    expect(costOf("google:gemini-3.8-flash", null, at)).toEqual(none);
    expect(costOf("google:gemini-3.8-flash", usage({ inputTokens: 10 }), at)).toEqual(none);
    expect(costOf("google:unknown", usage({ inputTokens: 10, outputTokens: 10 }), at)).toEqual(
      none,
    );
    expect(
      costOf(
        "google:gemini-3.8-flash",
        usage({ inputTokens: 1, outputTokens: 1 }),
        day("2020-01-01"),
      ),
    ).toEqual(none);
  });

  it("has a price for every model today, listed newest first", () => {
    for (const model of OCR_MODELS) {
      expect(priceAt(model, new Date()), model.id).toBeDefined();
      const froms = model.prices.map((p) => p.from);
      expect(froms, model.id).toEqual([...froms].sort().reverse());
    }
  });
});
