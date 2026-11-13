// The OpenAI request and response as the installed @ai-sdk/openai builds and reads them (Responses
// API), through the same extractReceipt path production uses. fetch is mocked: these tests never
// reach the network.
import { afterEach, describe, expect, it, vi } from "vitest";
import { OcrCallError, retryAfterMs } from "../src/errors";
import { extractReceipt } from "../src/extract";
import { FIXTURE_RECEIPTS } from "../src/fixture";
import { INJECTION_GUARD } from "../src/prompt";

const RECEIPT = FIXTURE_RECEIPTS[0]!;
const MODEL = "openai:gpt-6-luna" as const;
const keys = { openai: "sk-proj-test-key-not-real" };
const jpeg = { data: new Uint8Array([0xff, 0xd8, 0xff, 0xe0]), mediaType: "image/jpeg" };

type Captured = { url: string; headers: Headers; body: Record<string, unknown> };

function response(overrides: Record<string, unknown> = {}, text = JSON.stringify(RECEIPT)) {
  return {
    id: "resp_test",
    object: "response",
    created_at: 1,
    status: "completed",
    model: "gpt-6-luna",
    output: [
      {
        type: "message",
        id: "msg_test",
        role: "assistant",
        status: "completed",
        content: [{ type: "output_text", text, annotations: [] }],
      },
    ],
    usage: {
      input_tokens: 2400,
      input_tokens_details: { cached_tokens: 1000 },
      output_tokens: 380,
      output_tokens_details: { reasoning_tokens: 0 },
      total_tokens: 2780,
    },
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
) => json({ error: { message, type: "error", param: null, code } }, status, headers);

const run = (file = jpeg, maxRetries = 0) =>
  extractReceipt({ model: MODEL, keys, file, maxRetries });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the OpenAI request body", () => {
  it("sends strict JSON schema, no reasoning, no stored response and the image as a data URL", async () => {
    const calls = mockFetch(json(response()));
    await run();
    expect(calls).toHaveLength(1);
    const { url, body, headers } = calls[0]!;
    expect(url).toBe("https://api.openai.com/v1/responses");
    expect(headers.get("authorization")).toBe("Bearer sk-proj-test-key-not-real");
    expect(body.model).toBe("gpt-6-luna");
    expect(body.max_output_tokens).toBe(16_384);
    expect(body.reasoning).toMatchObject({ effort: "none" });
    expect(body.store).toBe(false);

    const format = (body.text as { format: Record<string, unknown> }).format as {
      type: string;
      strict: boolean;
      schema: Record<string, unknown>;
    };
    expect(format.type).toBe("json_schema");
    expect(format.strict).toBe(true);
    // Strict mode: every object lists all its keys and forbids extras.
    const schema = format.schema as {
      required: string[];
      properties: Record<string, unknown>;
      additionalProperties: boolean;
    };
    expect(schema.additionalProperties).toBe(false);
    expect([...schema.required].sort()).toEqual(Object.keys(schema.properties).sort());
    // Bounds are left out of the request (schemaMode), though the reply is still checked against them.
    for (const keyword of ["maxItems", "maxLength", "minLength", "minimum", "maximum"]) {
      expect(JSON.stringify(schema)).not.toContain(keyword);
    }
    expect(body).not.toHaveProperty("tools");

    const input = body.input as Array<{ role: string; content: unknown }>;
    expect(JSON.stringify(input[0])).toContain(INJECTION_GUARD);
    const user = input.find((m) => m.role === "user")!.content as Array<Record<string, unknown>>;
    expect(user.map((part) => part.type)).toEqual(["input_image", "input_text"]);
    expect(user[0]).toMatchObject({ image_url: "data:image/jpeg;base64,/9j/4A==" });
  });

  it("sends the chain step's effort", async () => {
    const calls = mockFetch(json(response()));
    await extractReceipt({ model: MODEL, keys, file: jpeg, maxRetries: 0, effort: "medium" });
    expect(calls[0]!.body.reasoning).toMatchObject({ effort: "medium" });
    expect(calls[0]!.body.max_output_tokens).toBe(16_384);
  });

  it("gives high room to reason: a 32,768 token cap", async () => {
    const calls = mockFetch(json(response()));
    await extractReceipt({ model: MODEL, keys, file: jpeg, maxRetries: 0, effort: "high" });
    expect(calls[0]!.body.max_output_tokens).toBe(32_768);
  });

  it("sends a PDF as an input_file", async () => {
    const calls = mockFetch(json(response()));
    await run({ data: new Uint8Array([0x25, 0x50, 0x44, 0x46]), mediaType: "application/pdf" });
    const input = calls[0]!.body.input as Array<{ role: string; content: unknown }>;
    const user = input.find((m) => m.role === "user")!.content as Array<Record<string, unknown>>;
    expect(user.map((part) => part.type)).toContain("input_file");
  });

  it("skips HEIC, an oversized PDF and an image over 30,000 patches without a call", async () => {
    const calls = mockFetch(json(response()));
    // PNG header for 6000 x 6000 px = 188 x 188 = 35,344 patches.
    const png = new Uint8Array(33);
    png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
    png.set([0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52], 8);
    new DataView(png.buffer).setUint32(16, 6000);
    new DataView(png.buffer).setUint32(20, 6000);
    for (const file of [
      { data: new Uint8Array([1, 2, 3]), mediaType: "image/heic" },
      { data: new Uint8Array(50_000_001), mediaType: "application/pdf" },
      { data: png, mediaType: "image/png" },
    ]) {
      const error = await run(file).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(OcrCallError);
      expect(error).toMatchObject({ kind: "unsupported-file", usage: null, skipped: true });
    }
    expect(calls).toHaveLength(0);
  });
});

describe("the OpenAI response", () => {
  it("returns the extraction and the token usage, with cached input split out", async () => {
    mockFetch(json(response()));
    const result = await run();
    expect(result.extraction).toEqual(RECEIPT);
    expect(result.model).toBe(MODEL);
    expect(result.usage).toMatchObject({
      inputTokens: 2400,
      cachedInputTokens: 1000,
      outputTokens: 380,
    });
  });

  it("rejects a reply that is JSON but not a receipt as invalid-output, keeping its usage", async () => {
    mockFetch(json(response({}, '{"merchant":"x"}')));
    const error = await run().catch((e: unknown) => e);
    expect(error).toMatchObject({
      kind: "invalid-output",
      usage: { inputTokens: 2400, outputTokens: 380 },
    });
  });

  it("treats a refusal, which the SDK cannot parse, as invalid-output so the chain moves on", async () => {
    mockFetch(
      json(
        response({
          output: [
            {
              type: "message",
              id: "msg_test",
              role: "assistant",
              status: "completed",
              content: [{ type: "refusal", refusal: "I can't help with that." }],
            },
          ],
        }),
      ),
    );
    const error = await run().catch((e: unknown) => e);
    expect(error).toMatchObject({ kind: "invalid-output" });
  });
});

describe("OpenAI errors", () => {
  it("429 rate limit: rate-limited, with the provider's retry-after, so the provider cools", async () => {
    mockFetch(apiError(429, "rate_limit_exceeded", { "retry-after": "23" }));
    const error = await run().catch((e: unknown) => e);
    expect(error).toMatchObject({ kind: "rate-limited", usage: null });
    expect(retryAfterMs(error)).toBe(23_000);
  });

  it.each([
    "insufficient_quota",
    "credit_balance_exhausted",
    "project_spend_limit_exceeded",
    "organization_usage_limit_exceeded",
  ])("429 %s: not-configured, since waiting does not help", async (code) => {
    mockFetch(apiError(429, code));
    const error = await run().catch((e: unknown) => e);
    expect(error).toMatchObject({ kind: "not-configured" });
  });

  it.each([500, 503])("%i: provider-error", async (status) => {
    mockFetch(apiError(status, "server_is_overloaded"));
    const error = await run().catch((e: unknown) => e);
    expect(error).toMatchObject({ kind: "provider-error" });
  });

  it.each([401, 403, 404])("%i: not-configured (bad key, region or model)", async (status) => {
    mockFetch(apiError(status, "invalid_api_key"));
    const error = await run().catch((e: unknown) => e);
    expect(error).toMatchObject({ kind: "not-configured" });
  });

  it("400 model_not_found: not-configured", async () => {
    mockFetch(apiError(400, "model_not_found", {}, "The model `gpt-6-luna` does not exist"));
    const error = await run().catch((e: unknown) => e);
    expect(error).toMatchObject({ kind: "not-configured" });
  });

  it("400 for a request the API rejects but not the image (a schema keyword or effort): not-configured", async () => {
    mockFetch(
      apiError(
        400,
        "invalid_json_schema",
        {},
        "Invalid schema for response_format: 'minLength' is not permitted.",
      ),
    );
    const error = await run().catch((e: unknown) => e);
    expect(error).toMatchObject({ kind: "not-configured" });
  });

  it("400 that names the image: bad-image", async () => {
    mockFetch(apiError(400, "invalid_image_format", {}, "You uploaded an unsupported image."));
    const error = await run().catch((e: unknown) => e);
    expect(error).toMatchObject({ kind: "bad-image" });
  });

  it("400 context_length_exceeded: unsupported-file, so a longer-context model can take it", async () => {
    mockFetch(apiError(400, "context_length_exceeded"));
    const error = await run().catch((e: unknown) => e);
    expect(error).toMatchObject({ kind: "unsupported-file", skipped: false });
  });

  it("413: unsupported-file, a request rather than a skip", async () => {
    mockFetch(apiError(413, "request_too_large"));
    const error = await run().catch((e: unknown) => e);
    expect(error).toMatchObject({ kind: "unsupported-file", skipped: false });
  });
});
