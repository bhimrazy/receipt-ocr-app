import { describe, expect, it } from "vitest";
import { providerNames, readingSentence } from "./receipt-reading";

const flash = { label: "Gemini 3.8 Flash", provider: "google" };
const sonnet = { label: "Claude Sonnet 5.5", provider: "anthropic" };
const lite = { label: "Gemini 3.5 Flash-Lite", provider: "google" };

describe("readingSentence", () => {
  it("names a single model", () => {
    expect(readingSentence([flash])).toBe("Platform default: Gemini 3.8 Flash");
  });

  it("lists fallbacks in chain order", () => {
    expect(readingSentence([flash, sonnet])).toBe(
      "Platform default: Gemini 3.8 Flash, then Claude Sonnet 5.5 if that fails",
    );
    expect(readingSentence([sonnet, flash, lite])).toBe(
      "Platform default: Claude Sonnet 5.5, then Gemini 3.8 Flash if that fails, then Gemini 3.5 Flash-Lite if that fails",
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
