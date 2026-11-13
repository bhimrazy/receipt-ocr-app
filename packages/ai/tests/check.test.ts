import { describe, expect, it, vi } from "vitest";
import { checkProvider, PROVIDER_CHECK_STATUSES } from "../src/check";
import { OCR_PROVIDERS } from "../src/models";

const KEY = "sk-fake-KEY-1234567890";
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const stub = (...responses: (Response | Error)[]) => {
  const fn = vi.fn(async (...args: [string | URL | Request, RequestInit?]) => {
    void args;
    const next = responses.shift()!;
    if (next instanceof Error) throw next;
    return next;
  });
  return Object.assign(fn, { fetch: fn as unknown as typeof fetch });
};
const gemini = (...names: string[]) =>
  json({ models: names.map((n) => ({ name: `models/${n}` })) });
const GOOGLE = ["google:gemini-3.8-flash"];

describe("checkProvider google", () => {
  it("is ok when the chain's models are listed, sending the key in a header only", async () => {
    const f = stub(gemini("gemini-3.8-flash", "other"));
    const result = await checkProvider("google", { apiKey: KEY, models: GOOGLE, fetch: f.fetch });
    expect(result.status).toBe("ok");
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    const [url, init] = f.mock.calls[0]!;
    expect(String(url)).not.toContain(KEY);
    expect(new Headers(init?.headers).get("x-goog-api-key")).toBe(KEY);
  });

  it("follows pagination to find a model on a later page", async () => {
    const f = stub(
      json({ models: [{ name: "models/a" }], nextPageToken: "p2" }),
      gemini("gemini-3.8-flash"),
    );
    expect(
      (await checkProvider("google", { apiKey: KEY, models: GOOGLE, fetch: f.fetch })).status,
    ).toBe("ok");
    expect(String(f.mock.calls[1]![0])).toContain("pageToken=p2");
  });

  it("reports a model missing from the list", async () => {
    const f = stub(gemini("something-else"));
    expect(
      (await checkProvider("google", { apiKey: KEY, models: GOOGLE, fetch: f.fetch })).status,
    ).toBe("model-not-available");
  });

  it.each([
    [401, {}, "invalid-key"],
    [403, {}, "invalid-key"],
    [400, { error: { details: [{ reason: "API_KEY_INVALID" }] } }, "invalid-key"],
    [402, {}, "no-billing-or-quota"],
    [
      429,
      {
        error: {
          details: [{ violations: [{ quotaId: "GenerateRequestsPerDayPerProjectPerModel" }] }],
        },
      },
      "no-billing-or-quota",
    ],
    [
      429,
      {
        error: {
          details: [{ violations: [{ quotaId: "GenerateRequestsPerMinutePerProjectPerModel" }] }],
        },
      },
      "rate-limited",
    ],
    [
      429,
      { error: { message: "You exceeded your current quota", details: [{ limit: 0 }] } },
      "no-billing-or-quota",
    ],
    [429, { error: { message: "You exceeded your current quota" } }, "rate-limited"],
    [429, { error: { message: "Too many requests" } }, "rate-limited"],
    [500, {}, "unreachable"],
    [400, {}, "unreachable"],
  ])("maps %i %j to %s", async (status, body, expected) => {
    const f = stub(json(body, status));
    expect(
      (await checkProvider("google", { apiKey: KEY, models: GOOGLE, fetch: f.fetch })).status,
    ).toBe(expected);
  });

  it("is unreachable on a network error or a malformed body", async () => {
    for (const next of [
      new Error(`connect failed for ${KEY}`),
      new Response("<html>", { status: 200 }),
    ]) {
      const f = stub(next);
      const result = await checkProvider("google", { apiKey: KEY, models: GOOGLE, fetch: f.fetch });
      expect(result).toEqual({ status: "unreachable", latencyMs: null });
    }
  });

  it("times out", async () => {
    const hang = vi.fn(
      (_u: unknown, init?: RequestInit) =>
        new Promise<Response>((_, reject) =>
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted"))),
        ),
    );
    const result = await checkProvider("google", {
      apiKey: KEY,
      models: GOOGLE,
      timeoutMs: 20,
      fetch: hang as unknown as typeof fetch,
    });
    expect(result.status).toBe("unreachable");
  });
});

describe("checkProvider anthropic", () => {
  const MODELS = ["anthropic:claude-sonnet-5-5"];
  const list = (...ids: string[]) => json({ data: ids.map((id) => ({ id })), has_more: false });

  it("sends x-api-key and anthropic-version, and is ok", async () => {
    const f = stub(list("claude-sonnet-5-5"));
    expect(
      (await checkProvider("anthropic", { apiKey: KEY, models: MODELS, fetch: f.fetch })).status,
    ).toBe("ok");
    const headers = new Headers(f.mock.calls[0]![1]?.headers);
    expect(headers.get("x-api-key")).toBe(KEY);
    expect(headers.get("anthropic-version")).toBeTruthy();
  });

  it("accepts a dated snapshot of the bare id, and rejects a different model", async () => {
    expect(
      (
        await checkProvider("anthropic", {
          apiKey: KEY,
          models: MODELS,
          fetch: stub(list("claude-sonnet-5-5-20261107")).fetch,
        })
      ).status,
    ).toBe("ok");
    expect(
      (
        await checkProvider("anthropic", {
          apiKey: KEY,
          models: MODELS,
          fetch: stub(list("claude-sonnet-5-50")).fetch,
        })
      ).status,
    ).toBe("model-not-available");
  });

  it("ignores chain models that belong to another provider", async () => {
    const f = stub(list("claude-sonnet-5-5"));
    expect(
      (
        await checkProvider("anthropic", {
          apiKey: KEY,
          models: ["google:gemini-3.8-flash"],
          fetch: f.fetch,
        })
      ).status,
    ).toBe("ok");
  });

  it.each([
    [401, "invalid-key"],
    [403, "invalid-key"],
    [402, "no-billing-or-quota"],
    [400, "no-billing-or-quota"],
    [429, "rate-limited"],
    [529, "unreachable"],
  ])("maps %i to %s", async (status, expected) => {
    const body =
      status === 400
        ? { error: { message: "Your credit balance is too low" } }
        : { error: { message: `bad key ${KEY}` } };
    const f = stub(json(body, status));
    expect(
      (await checkProvider("anthropic", { apiKey: KEY, models: MODELS, fetch: f.fetch })).status,
    ).toBe(expected);
  });
});

describe("checkProvider groq", () => {
  const MODELS = ["groq:qwen/qwen3.8-27b"];
  const list = (...ids: string[]) => json({ object: "list", data: ids.map((id) => ({ id })) });

  it("sends the key as a bearer token, and is ok when the model is listed", async () => {
    const f = stub(list("qwen/qwen3.8-27b", "other"));
    expect(
      (await checkProvider("groq", { apiKey: KEY, models: MODELS, fetch: f.fetch })).status,
    ).toBe("ok");
    expect(String(f.mock.calls[0]![0])).toBe("https://api.groq.com/openai/v1/models");
    expect(new Headers(f.mock.calls[0]![1]?.headers).get("authorization")).toBe(`Bearer ${KEY}`);
  });

  it.each([
    [401, {}, "invalid-key"],
    [
      429,
      { error: { message: "Rate limit reached for model on tokens per minute (TPM)" } },
      "rate-limited",
    ],
    [
      429,
      { error: { message: "Rate limit reached on tokens per day (TPD)" } },
      "no-billing-or-quota",
    ],
    [500, {}, "unreachable"],
  ])("maps HTTP %i %j to %s", async (status, body, expected) => {
    const f = stub(json(body, status));
    expect(
      (await checkProvider("groq", { apiKey: KEY, models: MODELS, fetch: f.fetch })).status,
    ).toBe(expected);
  });
});

describe("checkProvider openai", () => {
  const MODELS = ["openai:gpt-6-luna"];
  const list = (...ids: string[]) => json({ object: "list", data: ids.map((id) => ({ id })) });

  it("sends the key as a bearer token, and is ok when the model is listed", async () => {
    const f = stub(list("gpt-6-luna", "other"));
    expect(
      (await checkProvider("openai", { apiKey: KEY, models: MODELS, fetch: f.fetch })).status,
    ).toBe("ok");
    expect(String(f.mock.calls[0]![0])).toBe("https://api.openai.com/v1/models");
    expect(new Headers(f.mock.calls[0]![1]?.headers).get("authorization")).toBe(`Bearer ${KEY}`);
  });

  it("is model-not-available when the key cannot see the model", async () => {
    const f = stub(list("gpt-6.1-terra"));
    expect(
      (await checkProvider("openai", { apiKey: KEY, models: MODELS, fetch: f.fetch })).status,
    ).toBe("model-not-available");
  });

  it.each([
    [401, {}, "invalid-key"],
    [429, { error: { code: "rate_limit_exceeded" } }, "rate-limited"],
    [
      429,
      { error: { type: "insufficient_quota", code: "insufficient_quota" } },
      "no-billing-or-quota",
    ],
    [500, {}, "unreachable"],
  ])("maps HTTP %i %j to %s", async (status, body, expected) => {
    const f = stub(json(body, status));
    expect(
      (await checkProvider("openai", { apiKey: KEY, models: MODELS, fetch: f.fetch })).status,
    ).toBe(expected);
  });
});

describe("checkProvider results", () => {
  it("never contain the key, whatever the provider says", async () => {
    for (const id of ["google", "anthropic", "groq", "openai"] as const) {
      for (const status of [200, 400, 401, 402, 429, 500]) {
        const f = stub(
          json({ error: { message: `key ${KEY} rejected` }, models: [], data: [] }, status),
        );
        const result = await checkProvider(id, { apiKey: KEY, models: [], fetch: f.fetch });
        expect(JSON.stringify(result)).not.toContain(KEY);
        expect(PROVIDER_CHECK_STATUSES).toContain(result.status);
      }
    }
  });

  it("covers every provider in OCR_PROVIDERS", async () => {
    for (const p of OCR_PROVIDERS) {
      const f = stub(json({ models: [], data: [] }));
      const result = await checkProvider(p.id, { apiKey: KEY, models: [], fetch: f.fetch });
      expect(result.status).toBe("ok");
    }
  });
});
