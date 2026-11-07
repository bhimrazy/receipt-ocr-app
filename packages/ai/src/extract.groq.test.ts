// The Groq request and response as the installed @ai-sdk/groq builds and reads them, through
// the same extractReceipt path production uses. fetch is mocked: these tests never reach the network.
import { afterEach, describe, expect, it, vi } from "vitest";
import { OcrCallError, retryAfterMs } from "./errors";
import { extractReceipt } from "./extract";
import { FIXTURE_RECEIPTS } from "./fixture";
import { INJECTION_GUARD } from "./prompt";

const RECEIPT = FIXTURE_RECEIPTS[0]!;
const MODEL = "groq:qwen/qwen3.8-27b" as const;
const keys = { groq: "gsk_test-key-not-real" };
const jpeg = { data: new Uint8Array([0xff, 0xd8, 0xff, 0xe0]), mediaType: "image/jpeg" };

type Captured = { url: string; headers: Headers; body: Record<string, unknown> };

function completion(overrides: Record<string, unknown> = {}) {
  return {
    id: "chatcmpl-test",
    object: "chat.completion",
    created: 1,
    model: "qwen/qwen3.8-27b",
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: JSON.stringify(RECEIPT) },
        finish_reason: "stop",
      },
    ],
    usage: { prompt_tokens: 2400, completion_tokens: 380, total_tokens: 2780 },
    ...overrides,
  };
}

function mockFetch(...responses: Array<() => Response>) {
  const calls: Captured[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({
        url: String(url),
        headers: new Headers(init?.headers),
        body: JSON.parse(String(init?.body)) as Record<string, unknown>,
      });
      return responses[Math.min(calls.length, responses.length) - 1]!();
    }),
  );
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
  code: string,
  headers: Record<string, string> = {},
  message = "test",
) => json({ error: { message, type: "error", code } }, status, headers);

const run = (file = jpeg, maxRetries = 0) =>
  extractReceipt({ model: MODEL, keys, file, maxRetries });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the Groq request body", () => {
  it("sends best-effort JSON schema, instruct mode and the image as a data URL", async () => {
    const calls = mockFetch(json(completion()));
    await run();
    expect(calls).toHaveLength(1);
    const { url, body, headers } = calls[0]!;
    expect(url).toBe("https://api.groq.com/openai/v1/chat/completions");
    expect(headers.get("authorization")).toBe("Bearer gsk_test-key-not-real");
    expect(body.model).toBe("qwen/qwen3.8-27b");
    expect(body.max_tokens).toBe(16_384);
    expect(body.reasoning_effort).toBe("none");

    const format = body.response_format as {
      type: string;
      json_schema: { strict: boolean; schema: Record<string, unknown> };
    };
    expect(format.type).toBe("json_schema");
    expect(format.json_schema.strict).toBe(false);
    expect(format.json_schema.schema).toMatchObject({
      type: "object",
      properties: { merchant: expect.anything(), total: expect.anything() },
    });
    // Size bounds are left out of the request (schemaMode), though the reply is still checked against them.
    for (const keyword of ["maxItems", "maxLength", "minimum", "maximum"]) {
      expect(JSON.stringify(format.json_schema.schema)).not.toContain(keyword);
    }
    expect(body).not.toHaveProperty("tools");

    const messages = body.messages as Array<{ role: string; content: unknown }>;
    expect(messages.map((m) => m.role)).toEqual(["system", "user"]);
    expect(JSON.stringify(messages[0]!.content)).toContain(INJECTION_GUARD);
    const content = messages[1]!.content as Array<Record<string, unknown>>;
    expect(content.map((part) => part.type)).toEqual(["image_url", "text"]);
    expect(content[0]).toMatchObject({ image_url: { url: "data:image/jpeg;base64,/9j/4A==" } });
  });

  it("skips a PDF and HEIC without a call, so the chain moves on to a model that reads them", async () => {
    const calls = mockFetch(json(completion()));
    for (const mediaType of ["application/pdf", "image/heic"]) {
      const error = await run({ data: new Uint8Array([1, 2, 3]), mediaType }).catch(
        (e: unknown) => e,
      );
      expect(error).toBeInstanceOf(OcrCallError);
      expect(error).toMatchObject({ kind: "unsupported-file", usage: null, skipped: true });
    }
    expect(calls).toHaveLength(0);
  });

  it("skips an image over 20 MB base64 without a call, and sends one just under", async () => {
    const calls = mockFetch(json(completion()));
    // 15,000,000 bytes encode to exactly 20,000,000 base64 characters.
    const under = { data: new Uint8Array(15_000_000), mediaType: "image/png" };
    const over = { data: new Uint8Array(15_000_001), mediaType: "image/png" };
    const error = await run(over).catch((e: unknown) => e);
    expect(error).toMatchObject({ kind: "unsupported-file", usage: null, skipped: true });
    expect(calls).toHaveLength(0);
    await run(under);
    expect(calls).toHaveLength(1);
  });
});

describe("the Groq response", () => {
  it("returns the extraction and the token usage", async () => {
    mockFetch(json(completion()));
    const result = await run();
    expect(result.extraction).toEqual(RECEIPT);
    expect(result.model).toBe(MODEL);
    expect(result.usage).toMatchObject({ inputTokens: 2400, outputTokens: 380 });
  });

  it("rejects a reply that is JSON but not a receipt as invalid-output, keeping its usage", async () => {
    mockFetch(
      json(
        completion({
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: '{"merchant":"x"}' },
              finish_reason: "stop",
            },
          ],
        }),
      ),
    );
    const error = await run().catch((e: unknown) => e);
    expect(error).toMatchObject({
      kind: "invalid-output",
      usage: { inputTokens: 2400, outputTokens: 380 },
    });
  });
});

describe("Groq errors", () => {
  it("429: rate-limited, with the provider's retry-after, so the provider cools", async () => {
    mockFetch(
      apiError(429, "rate_limit_exceeded", { "retry-after": "23" }, "Rate limit reached (TPM)"),
    );
    const error = await run().catch((e: unknown) => e);
    expect(error).toMatchObject({ kind: "rate-limited", usage: null });
    expect(retryAfterMs(error)).toBe(23_000);
  });

  it("500: provider-error", async () => {
    mockFetch(apiError(500, "internal_server_error"));
    const error = await run().catch((e: unknown) => e);
    expect(error).toMatchObject({ kind: "provider-error" });
  });

  it("401: not-configured (bad or revoked key)", async () => {
    mockFetch(apiError(401, "invalid_api_key"));
    const error = await run().catch((e: unknown) => e);
    expect(error).toMatchObject({ kind: "not-configured" });
  });

  it("404: not-configured (a model the key's org can't use)", async () => {
    mockFetch(apiError(404, "model_not_found"));
    const error = await run().catch((e: unknown) => e);
    expect(error).toMatchObject({ kind: "not-configured" });
  });

  it("400 model_decommissioned (Groq's answer for a retired preview model): not-configured", async () => {
    mockFetch(
      json(
        {
          error: {
            message:
              "The model `qwen/qwen3.8-27b` has been decommissioned and is no longer supported. Please refer to https://console.groq.com/docs/deprecations for a recommendation on which model to use instead.",
            type: "invalid_request_error",
            code: "model_decommissioned",
          },
        },
        400,
      ),
    );
    const error = await run().catch((e: unknown) => e);
    expect(error).toMatchObject({ kind: "not-configured" });
  });

  it("400 json_validate_failed: invalid-output (not bad-image), without retrying", async () => {
    const calls = mockFetch(
      json(
        {
          error: {
            message:
              "Generated JSON does not match the expected schema. Please adjust your prompt. See 'failed_generation' for more details.",
            type: "invalid_request_error",
            code: "json_validate_failed",
            failed_generation: '{"merchant": 12}',
          },
        },
        400,
      ),
    );
    const error = await run(jpeg, 2).catch((e: unknown) => e);
    expect(error).toMatchObject({ kind: "invalid-output" });
    expect((error as Error).message).toBe("OCR call failed: invalid-output (HTTP 400)");
    expect(calls).toHaveLength(1);
  });

  it("400 for a request the API rejects but not the image (a schema keyword): not-configured", async () => {
    mockFetch(
      json(
        {
          error: {
            message: "response_format.json_schema.schema: unsupported keyword 'nullable'",
            type: "invalid_request_error",
          },
        },
        400,
      ),
    );
    const error = await run().catch((e: unknown) => e);
    expect(error).toMatchObject({ kind: "not-configured" });
  });

  it("400 that names the image: bad-image", async () => {
    mockFetch(
      json(
        {
          error: { message: "invalid image data", type: "invalid_request_error" },
        },
        400,
      ),
    );
    const error = await run().catch((e: unknown) => e);
    expect(error).toMatchObject({ kind: "bad-image" });
  });

  it("413: unsupported-file, a request rather than a skip", async () => {
    mockFetch(apiError(413, "request_too_large"));
    const error = await run().catch((e: unknown) => e);
    expect(error).toMatchObject({ kind: "unsupported-file", skipped: false });
  });
});
