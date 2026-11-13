import { MockLanguageModelV4 } from "ai/test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OcrCallError } from "../src/errors";
import { extractReceipt, extractWith } from "../src/extract";
import { FIXTURE_FAIL_MARKER, FIXTURE_RECEIPTS, fixtureLatencyMs } from "../src/fixture";
import { receiptExtractionSchema } from "../src/schema";

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
    expect(usage.inputTokens).toBe(0);
    expect(usage.outputTokens).toBe(0);
  });

  it("fails on demand as an OcrCallError, to exercise the failure path end to end", async () => {
    const error = await extractReceipt({
      model: "fixture",
      file: file(`a ${FIXTURE_FAIL_MARKER} b`),
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(OcrCallError);
    expect(error).toMatchObject({ kind: "provider-error", usage: null });
  });
});

const googleUsage = {
  inputTokens: { total: 1200, noCache: 1000, cacheRead: 200, cacheWrite: undefined },
  outputTokens: { total: 300, text: 120, reasoning: 180 },
};

const reply = (text: string, finish: "stop" | "length" | "content-filter" = "stop") =>
  new MockLanguageModelV4({
    doGenerate: {
      content: text ? [{ type: "text", text }] : [],
      finishReason: { unified: finish, raw: finish },
      usage: googleUsage,
      warnings: [],
    },
  });

const expectedUsage = {
  inputTokens: 1200,
  cachedInputTokens: 200,
  cacheWriteTokens: null,
  outputTokens: 300,
  reasoningTokens: 180,
};

describe("extractWith (mock model)", () => {
  it("returns the extraction with cache and reasoning split out of the totals", async () => {
    const result = await extractWith(reply(JSON.stringify(FIXTURE_RECEIPTS[0])), {
      file: file("x"),
      maxRetries: 0,
    });
    expect(result.extraction).toEqual(FIXTURE_RECEIPTS[0]);
    expect(result.usage).toEqual(expectedUsage);
  });

  it("keeps the usage of a billed call whose output failed the schema", async () => {
    const error = await extractWith(reply('{"merchant": 3}'), {
      file: file("x"),
      maxRetries: 0,
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(OcrCallError);
    expect(error).toMatchObject({ kind: "invalid-output", usage: expectedUsage });
  });

  it("never puts the model's output (receipt contents) in the error message", async () => {
    const leaked = { ...FIXTURE_RECEIPTS[0]!, merchant: "Dr Smith Clinic", total: "12" };
    const error = await extractWith(reply(JSON.stringify(leaked)), {
      file: file("x"),
      maxRetries: 0,
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(OcrCallError);
    const line = JSON.stringify({ message: (error as Error).message, error });
    expect((error as Error).message).toBe("OCR call failed: invalid-output");
    expect(line).not.toContain("Dr Smith");
    // The original stays reachable for debugging in-process.
    expect(String((error as { cause: { cause?: unknown } }).cause.cause)).toContain("Dr Smith");
  });

  it("keeps the usage of a truncated reply with no output", async () => {
    const error = await extractWith(reply("", "length"), { file: file("x"), maxRetries: 0 }).catch(
      (e: unknown) => e,
    );
    expect(error).toMatchObject({ kind: "invalid-output", usage: expectedUsage });
  });

  it.each([
    ["text that parses", JSON.stringify(FIXTURE_RECEIPTS[0])],
    ["prose", "I can't help with that."],
    ["no text", ""],
  ])("reads a safety stop with %s as refused, keeping its usage", async (_, text) => {
    const error = await extractWith(reply(text, "content-filter"), {
      file: file("x"),
      maxRetries: 0,
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(OcrCallError);
    expect(error).toMatchObject({ kind: "refused", usage: expectedUsage });
  });

  it("has no usage when the provider call itself failed", async () => {
    const model = new MockLanguageModelV4({
      doGenerate: async () => {
        throw new TypeError("fetch failed");
      },
    });
    const error = await extractWith(model, { file: file("x"), maxRetries: 0 }).catch(
      (e: unknown) => e,
    );
    expect(error).toMatchObject({ kind: "provider-error", usage: null });
  });
});

describe("number-format guidance in the prompt", () => {
  const promptSent = async () => {
    const model = reply(JSON.stringify(FIXTURE_RECEIPTS[0]));
    await extractWith(model, { file: file("x"), maxRetries: 0 });
    return JSON.stringify(model.doGenerateCalls[0]!.prompt);
  };

  it("lets three-minor-unit currencies read three digits as the fraction", async () => {
    const prompt = await promptSent();
    for (const code of ["KWD", "BHD", "OMR", "JOD", "TND", "LYD", "KD", "DT"]) {
      expect(prompt).toContain(code);
    }
    expect(prompt).toContain("three digits after the decimal mark are the fraction");
  });

  it("keeps the thousands rule for other currencies", async () => {
    const prompt = await promptSent();
    expect(prompt).toContain("almost always thousands");
    expect(prompt).toContain("25.000");
  });
});

describe("FIXTURE_LATENCY_MS", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it("is 0 when unset or invalid, and capped", () => {
    expect(fixtureLatencyMs()).toBe(0);
    vi.stubEnv("FIXTURE_LATENCY_MS", "abc");
    expect(fixtureLatencyMs()).toBe(0);
    vi.stubEnv("FIXTURE_LATENCY_MS", "-5");
    expect(fixtureLatencyMs()).toBe(0);
    vi.stubEnv("FIXTURE_LATENCY_MS", "999999");
    expect(fixtureLatencyMs()).toBe(60_000);
  });

  it("waits FIXTURE_LATENCY_MS before the fixture provider answers", async () => {
    vi.useFakeTimers();
    vi.stubEnv("FIXTURE_LATENCY_MS", "2000");
    let done = false;
    const call = extractReceipt({ model: "fixture", file: file("slow") }).then(() => {
      done = true;
    });
    await vi.advanceTimersByTimeAsync(1999);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await call;
    expect(done).toBe(true);
  });
});
