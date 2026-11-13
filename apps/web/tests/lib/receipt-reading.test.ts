import { describe, expect, it } from "vitest";
import { providerNames, readingSentence } from "@/lib/receipt-reading";

const flash = { label: "Gemini 3.8 Flash", provider: "google" };
const sonnet = { label: "Claude Sonnet 5.5", provider: "anthropic" };
const lite = { label: "Gemini 3.5 Flash-Lite", provider: "google" };

describe("readingSentence", () => {
  it("names a single model", () => {
    expect(readingSentence([flash])).toBe("Your receipts are scanned by Gemini 3.8 Flash.");
  });

  it("lists fallbacks in chain order", () => {
    expect(readingSentence([flash, sonnet])).toBe(
      "Your receipts are scanned by Gemini 3.8 Flash. If it can't scan one, Claude Sonnet 5.5 tries next.",
    );
    expect(readingSentence([sonnet, flash, lite])).toBe(
      "Your receipts are scanned by Claude Sonnet 5.5. If it can't scan one, Gemini 3.8 Flash tries next, then Gemini 3.5 Flash-Lite.",
    );
  });

  it("is null when nothing can run", () => {
    expect(readingSentence([])).toBeNull();
  });
});

describe("providerNames", () => {
  it("lists each provider once, in order", () => {
    expect(providerNames([sonnet, flash, lite])).toEqual(["Anthropic", "Google"]);
  });

  it("skips providers with no outside processor", () => {
    expect(providerNames([{ label: "Fixture", provider: "fixture" }])).toEqual([]);
  });
});
