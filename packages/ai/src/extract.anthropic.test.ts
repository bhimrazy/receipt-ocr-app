// The Anthropic request and response as the installed @ai-sdk/anthropic builds and
// reads them, through the same extractReceipt path production uses. fetch is mocked:
// these tests never reach the network.
import { afterEach, describe, expect, it, vi } from "vitest";
import { OcrCallError, retryAfterMs } from "./errors";
import { extractReceipt, type ModelId } from "./extract";
import { FIXTURE_RECEIPTS } from "./fixture";
import { FIELD_DESCRIPTIONS, V3_FIELD_DESCRIPTIONS } from "./schema";
import { INJECTION_GUARD } from "./prompt";

const RECEIPT = FIXTURE_RECEIPTS[0]!;
const keys = { anthropic: "test-key-not-real" };
const jpeg = { data: new Uint8Array([0xff, 0xd8, 0xff, 0xe0]), mediaType: "image/jpeg" };

type Captured = { url: string; headers: Headers; body: Record<string, unknown> };

function message(overrides: Record<string, unknown> = {}) {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: "claude-sonnet-5-5",
    content: [{ type: "text", text: JSON.stringify(RECEIPT) }],
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: {
      input_tokens: 1500,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
      output_tokens: 420,
    },
    ...overrides,
  };
}

/** Stubs global fetch with one response per call (the last one repeats) and records each request. */
function mockFetch(...responses: Array<() => Response>) {
  const calls: Captured[] = [];
  const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(url),
      headers: new Headers(init?.headers),
      body: JSON.parse(String(init?.body)) as Record<string, unknown>,
    });
    return responses[Math.min(calls.length, responses.length) - 1]!();
  });
  vi.stubGlobal("fetch", fetch);
  return calls;
}

const json =
  (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json", ...headers },
    });

const apiError = (
  status: number,
  type: string,
  headers: Record<string, string> = {},
  message = "test",
) => json({ type: "error", error: { type, message } }, status, headers);

const run = (model: ModelId, file = jpeg, maxRetries = 0) =>
  extractReceipt({ model, keys, file, maxRetries });

afterEach(() => {
  vi.unstubAllGlobals();
});

const MODELS = [
  "anthropic:claude-haiku-5-5",
  "anthropic:claude-sonnet-5-5",
  "anthropic:claude-opus-5-5",
] as const;

describe("the Anthropic request body", () => {
  it.each(MODELS)(
    "%s: native structured output, low effort, nothing the model rejects",
    async (model) => {
      const calls = mockFetch(json(message()));
      await run(model);
      expect(calls).toHaveLength(1);
      const { url, body, headers } = calls[0]!;
      expect(url).toBe("https://api.anthropic.com/v1/messages");
      expect(headers.get("x-api-key")).toBe("test-key-not-real");
      expect(body.model).toBe(model.slice("anthropic:".length));
      expect(body.max_tokens).toBe(16_384);

      // JSON schema through output_config.format; no forced tool call (a 400 on Sonnet/Opus 5.5).
      const outputConfig = body.output_config as {
        effort: string;
        format: Record<string, unknown>;
      };
      expect(outputConfig.effort).toBe("low");
      expect(outputConfig.format.type).toBe("json_schema");
      expect(outputConfig.format.schema).toMatchObject({
        type: "object",
        properties: { merchant: expect.anything(), total: expect.anything() },
      });
      expect(body).not.toHaveProperty("tools");
      expect(body).not.toHaveProperty("tool_choice");

      // Thinking stays adaptive by default; sampling params and budgets 400 on these models.
      for (const key of ["thinking", "temperature", "top_p", "top_k", "budget_tokens"]) {
        expect(body).not.toHaveProperty(key);
      }

      // The rules as the system prompt, then one user turn with the image before its text
      // (Claude's vision guidance); no assistant prefill.
      expect(JSON.stringify(body.system)).toContain(INJECTION_GUARD);
      const messages = body.messages as Array<{
        role: string;
        content: Array<Record<string, unknown>>;
      }>;
      expect(messages.map((m) => m.role)).toEqual(["user"]);
      expect(messages[0]!.content.map((part) => part.type)).toEqual(["image", "text"]);
      expect(messages[0]!.content[0]).toMatchObject({
        source: { type: "base64", media_type: "image/jpeg", data: "/9j/4A==" },
      });
    },
  );

  it("sends the v3 field definitions in the schema, and v1 as it was for the A/B", async () => {
    const calls = mockFetch(json(message()));
    const v3 = await run("anthropic:claude-haiku-5-5");
    expect(v3.promptVersion).toBe("v3");
    const format = (i: number) =>
      JSON.stringify((calls[i]!.body.output_config as { format: unknown }).format);
    expect(format(0)).toContain(JSON.stringify(FIELD_DESCRIPTIONS.subtotal));
    expect(format(0)).toContain(JSON.stringify(V3_FIELD_DESCRIPTIONS.invoiceNumber));

    const v1 = await extractReceipt({
      model: "anthropic:claude-haiku-5-5",
      keys,
      file: jpeg,
      maxRetries: 0,
      promptVersion: "v1",
    });
    expect(v1.promptVersion).toBe("v1");
    expect(format(1)).not.toContain(JSON.stringify(FIELD_DESCRIPTIONS.subtotal));
    expect(calls[1]!.body).not.toHaveProperty("system");
    const content = (calls[1]!.body.messages as Array<{ content: Array<{ type: string }> }>)[0]!
      .content;
    expect(content.map((part) => part.type)).toEqual(["text", "image"]);
  });

  it("sends a PDF as a base64 document block", async () => {
    const calls = mockFetch(json(message()));
    const pdf = { data: new TextEncoder().encode("%PDF-1.7"), mediaType: "application/pdf" };
    await run("anthropic:claude-haiku-5-5", pdf);
    const messages = calls[0]!.body.messages as Array<{ content: Array<Record<string, unknown>> }>;
    expect(messages[0]!.content[0]).toMatchObject({
      type: "document",
      source: { type: "base64", media_type: "application/pdf", data: "JVBERi0xLjc=" },
    });
  });

  it("skips HEIC without a call, as a kind that moves the chain to the next model", async () => {
    const calls = mockFetch(json(message()));
    const heic = { data: new Uint8Array([0, 0, 0, 24]), mediaType: "image/heic" };
    const error = await run("anthropic:claude-haiku-5-5", heic).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(OcrCallError);
    expect(error).toMatchObject({ kind: "unsupported-file", usage: null, skipped: true });
    expect(calls).toHaveLength(0);
  });

  it("skips an image over Claude's 10 MB base64 limit without a call, and sends one just under", async () => {
    const calls = mockFetch(json(message()));
    // 7,500,000 bytes encode to exactly 10,000,000 base64 characters.
    const under = { data: new Uint8Array(7_500_000), mediaType: "image/png" };
    const over = { data: new Uint8Array(7_500_001), mediaType: "image/png" };
    const error = await run("anthropic:claude-haiku-5-5", over).catch((e: unknown) => e);
    expect(error).toMatchObject({ kind: "unsupported-file", usage: null });
    expect(calls).toHaveLength(0);
    await run("anthropic:claude-haiku-5-5", under);
    expect(calls).toHaveLength(1);
  });
});

describe("Claude's per-image pixel limit", () => {
  const png = (width: number, height: number) => {
    const be32 = (n: number) => [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
    return new Uint8Array([
      0x89,
      0x50,
      0x4e,
      0x47,
      13,
      10,
      26,
      10,
      ...be32(13),
      0x49,
      0x48,
      0x44,
      0x52,
      ...be32(width),
      ...be32(height),
    ]);
  };

  it("skips an image over 8000 px without a call, so the chain can try Gemini", async () => {
    const calls = mockFetch(json(message()));
    const error = await run("anthropic:claude-haiku-5-5", {
      data: png(8001, 600),
      mediaType: "image/png",
    }).catch((e: unknown) => e);
    expect(error).toMatchObject({ kind: "unsupported-file", usage: null });
    expect(calls).toHaveLength(0);
  });

  it("sends an image exactly 8000 px long", async () => {
    const calls = mockFetch(json(message()));
    await run("anthropic:claude-haiku-5-5", { data: png(600, 8000), mediaType: "image/png" });
    expect(calls).toHaveLength(1);
  });
});

describe("the Anthropic response", () => {
  it("returns the extraction and records input, output, cache and thinking tokens", async () => {
    mockFetch(
      json(
        message({
          usage: {
            input_tokens: 1000,
            cache_read_input_tokens: 300,
            cache_creation_input_tokens: 200,
            output_tokens: 500,
            output_tokens_details: { thinking_tokens: 120 },
          },
        }),
      ),
    );
    const result = await run("anthropic:claude-sonnet-5-5");
    expect(result.extraction).toEqual(RECEIPT);
    expect(result.model).toBe("anthropic:claude-sonnet-5-5");
    // Anthropic's input_tokens exclude cache reads and writes; the ledger total includes them.
    expect(result.usage).toEqual({
      inputTokens: 1500,
      cachedInputTokens: 300,
      cacheWriteTokens: 200,
      outputTokens: 500,
      reasoningTokens: 120,
    });
  });

  it.each([
    ["prose", [{ type: "text", text: "I can't help with reading this document." }]],
    ["no", []],
  ])("treats a refusal with %s text as refused, keeping its usage", async (_, content) => {
    mockFetch(
      json(
        message({
          content,
          stop_reason: "refusal",
          stop_details: { type: "refusal", category: null, explanation: null },
        }),
      ),
    );
    const error = await run("anthropic:claude-sonnet-5-5").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(OcrCallError);
    expect(error).toMatchObject({
      kind: "refused",
      usage: { inputTokens: 1500, outputTokens: 420 },
    });
    expect((error as Error).message).toBe("OCR call failed: refused");
  });

  it("treats a refusal as a failed, billed call, even when its text parses", async () => {
    mockFetch(
      json(
        message({
          stop_reason: "refusal",
          stop_details: { type: "refusal", category: null, explanation: null },
        }),
      ),
    );
    const error = await run("anthropic:claude-opus-5-5").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(OcrCallError);
    expect(error).toMatchObject({
      kind: "refused",
      usage: { inputTokens: 1500, outputTokens: 420 },
    });
    expect((error as Error).message).toBe("OCR call failed: refused");
  });
});

describe("Anthropic errors", () => {
  it("429: rate-limited, with the provider's Retry-After", async () => {
    mockFetch(apiError(429, "rate_limit_error", { "retry-after": "17" }));
    const error = await run("anthropic:claude-haiku-5-5").catch((e: unknown) => e);
    expect(error).toMatchObject({ kind: "rate-limited", usage: null });
    expect(retryAfterMs(error)).toBe(17_000);
  });

  it("529 overloaded: provider-error", async () => {
    mockFetch(apiError(529, "overloaded_error"));
    const error = await run("anthropic:claude-sonnet-5-5").catch((e: unknown) => e);
    expect(error).toMatchObject({ kind: "provider-error" });
    expect((error as Error).message).toContain("HTTP 529");
  });

  it("500: provider-error", async () => {
    mockFetch(apiError(500, "api_error"));
    const error = await run("anthropic:claude-sonnet-5-5").catch((e: unknown) => e);
    expect(error).toMatchObject({ kind: "provider-error" });
  });

  it("400 about the image: bad-image, and the SDK does not retry it", async () => {
    const calls = mockFetch(apiError(400, "invalid_request_error", {}, "Could not process image"));
    const error = await run("anthropic:claude-opus-5-5", jpeg, 2).catch((e: unknown) => e);
    expect(error).toMatchObject({ kind: "bad-image" });
    expect(calls).toHaveLength(1);
  });

  it("400 about the request, not the image: not-configured, so the chain moves on", async () => {
    const calls = mockFetch(
      apiError(400, "invalid_request_error", {}, "output_config.effort: unsupported value"),
    );
    const error = await run("anthropic:claude-opus-5-5", jpeg, 2).catch((e: unknown) => e);
    expect(error).toMatchObject({ kind: "not-configured" });
    expect(calls).toHaveLength(1);
  });

  it("402 billing_error: not-configured, so the chain falls back while an admin fixes billing", async () => {
    mockFetch(apiError(402, "billing_error"));
    const error = await run("anthropic:claude-haiku-5-5").catch((e: unknown) => e);
    expect(error).toMatchObject({ kind: "not-configured" });
  });

  it("413: unsupported-file, so the chain falls back, but it was a request, not a skip", async () => {
    mockFetch(apiError(413, "request_too_large"));
    const error = await run("anthropic:claude-haiku-5-5").catch((e: unknown) => e);
    expect(error).toMatchObject({ kind: "unsupported-file", skipped: false });
  });

  it("401: not-configured (bad or revoked key)", async () => {
    mockFetch(apiError(401, "authentication_error"));
    const error = await run("anthropic:claude-haiku-5-5").catch((e: unknown) => e);
    expect(error).toMatchObject({ kind: "not-configured" });
  });
});

describe("a 2xx reply the SDK cannot parse", () => {
  it("is invalid-output, not bad-image, so the chain moves on", async () => {
    mockFetch(json({ unexpected: true }));
    const error = await run("anthropic:claude-haiku-5-5").catch((e: unknown) => e);
    expect(error).toMatchObject({ kind: "invalid-output" });
  });
});
