// What each provider is sent for a chain step's effort. Values are the ones in each provider's docs
// (see the effort fields in models.ts); an unset step keeps the model's default.
import { describe, expect, it } from "vitest";
import { maxOutputTokensFor, providerOptionsFor } from "../src/extract";

describe("providerOptionsFor effort", () => {
  it("Claude: low unless the step chooses, any of the five levels when it does", () => {
    expect(providerOptionsFor("anthropic:claude-sonnet-5-5")).toEqual({
      anthropic: { structuredOutputMode: "outputFormat", effort: "low" },
    });
    for (const effort of ["low", "medium", "high"]) {
      expect(providerOptionsFor("anthropic:claude-opus-5-5", effort)).toEqual({
        anthropic: { structuredOutputMode: "outputFormat", effort },
      });
    }
  });

  it("Gemini: no thinking setting unless the step chooses a thinking level", () => {
    expect(providerOptionsFor("google:gemini-3.8-flash")).toBeUndefined();
    expect(providerOptionsFor("google:gemini-3.8-flash", "high")).toEqual({
      google: { thinkingConfig: { thinkingLevel: "high" } },
    });
    expect(providerOptionsFor("google:gemini-3.5-flash-lite", "minimal")).toEqual({
      google: { thinkingConfig: { thinkingLevel: "minimal" } },
    });
  });

  it("OpenAI: none unless the step chooses, and never stores the response", () => {
    expect(providerOptionsFor("openai:gpt-6-luna")).toMatchObject({
      openai: { reasoningEffort: "none", store: false },
    });
    expect(providerOptionsFor("openai:gpt-6.1-terra", "high")).toMatchObject({
      openai: { reasoningEffort: "high", store: false },
    });
  });

  it("Groq: always none", () => {
    expect(providerOptionsFor("groq:qwen/qwen3.8-27b")).toMatchObject({
      groq: { reasoningEffort: "none" },
    });
    expect(providerOptionsFor("groq:qwen/qwen3.8-27b", "high")).toMatchObject({
      groq: { reasoningEffort: "none" },
    });
  });

  it("xhigh and max are not offered: they fall back to the default", () => {
    expect(providerOptionsFor("anthropic:claude-opus-5-5", "max")).toMatchObject({
      anthropic: { effort: "low" },
    });
    expect(providerOptionsFor("openai:gpt-6-luna", "xhigh")).toMatchObject({
      openai: { reasoningEffort: "none" },
    });
  });

  it("a value the model doesn't take (a stale saved chain) falls back instead of reaching the API", () => {
    expect(providerOptionsFor("anthropic:claude-haiku-5-5", "minimal")).toMatchObject({
      anthropic: { effort: "low" },
    });
    expect(providerOptionsFor("google:gemini-3.8-flash", "minimal")).toBeUndefined();
    expect(providerOptionsFor("openai:gpt-6-luna", "minimal")).toMatchObject({
      openai: { reasoningEffort: "none" },
    });
  });
});

describe("maxOutputTokensFor", () => {
  it("keeps 16,384 up to medium and gives high, xhigh and max more room for reasoning", () => {
    for (const effort of [null, "none", "minimal", "low", "medium"]) {
      expect(maxOutputTokensFor(effort)).toBe(16_384);
    }
    expect(maxOutputTokensFor("high")).toBe(32_768);
    expect(maxOutputTokensFor("xhigh")).toBe(65_536);
    expect(maxOutputTokensFor("max")).toBe(65_536);
  });
});
