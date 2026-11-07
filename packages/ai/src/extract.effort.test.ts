// What each provider is sent for a chain step's effort. Values are the ones in each provider's docs
// (see the effort fields in models.ts); an unset step keeps the behaviour that predates the setting.
import { describe, expect, it } from "vitest";
import { providerOptionsFor } from "./extract";

describe("providerOptionsFor effort", () => {
  it("Claude: low unless the step chooses, any of the five levels when it does", () => {
    expect(providerOptionsFor("anthropic:claude-sonnet-5-5")).toEqual({
      anthropic: { structuredOutputMode: "outputFormat", effort: "low" },
    });
    for (const effort of ["low", "medium", "high", "xhigh", "max"]) {
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
    expect(providerOptionsFor("openai:gpt-6.1-terra", "xhigh")).toMatchObject({
      openai: { reasoningEffort: "xhigh", store: false },
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
