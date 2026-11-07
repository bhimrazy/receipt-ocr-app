import { Effect, Exit } from "effect";
import { describe, expect, it } from "vitest";
import {
  DbError,
  InvalidInput,
  NotConfigured,
  OcrError,
  ProvidersCooling,
  StorageError,
} from "../errors";
import { withoutCooling } from "../ocr";
import type { OcrStep } from "../settings";
import { backoffMs } from "./backoff";
import {
  classifyExtractionError,
  cooldownsFrom,
  EXTRACTION_REFUSED_MESSAGE,
  finalFailureMessage,
} from "./kinds/receipt-extract";
import { receiptExtractJob, receiptExtractPayload } from "./receipt-extract-job";
import { JOB_REGISTRY } from "./registry";

const policy = { baseMs: 10_000, capMs: 600_000 };

describe("backoffMs", () => {
  it("doubles from the base, with jitter between half and all of it", () => {
    for (const [attempt, full] of [
      [1, 10_000],
      [2, 20_000],
      [3, 40_000],
    ] as const) {
      expect(backoffMs(attempt, policy, undefined, () => 0)).toBe(full / 2);
      expect(backoffMs(attempt, policy, undefined, () => 1)).toBe(full);
      const random = backoffMs(attempt, policy);
      expect(random).toBeGreaterThanOrEqual(full / 2);
      expect(random).toBeLessThanOrEqual(full);
    }
  });

  it("stops growing at the cap", () => {
    expect(backoffMs(30, policy, undefined, () => 1)).toBe(600_000);
  });

  it("waits at least the provider's Retry-After, but no longer than the cap", () => {
    expect(backoffMs(1, policy, 45_000, () => 0)).toBe(45_000);
    expect(backoffMs(1, policy, 1_000, () => 1)).toBe(10_000);
    expect(backoffMs(1, policy, 86_400_000, () => 0)).toBe(600_000);
  });
});

const attempt = (kind: OcrError["kind"] | "ok", retryAfterMs?: number) => ({
  model: "google:gemini-3.8-flash",
  step: 0,
  kind,
  ms: 5,
  usage: null,
  ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
});
const ocrError = (kind: OcrError["kind"], attempts = [attempt(kind)]) =>
  new OcrError({ message: "x", kind, attempts });

describe("finalFailureMessage", () => {
  it("tells the user a refusal won't change on a retry", () => {
    expect(finalFailureMessage("refused")).toBe(EXTRACTION_REFUSED_MESSAGE);
    expect(EXTRACTION_REFUSED_MESSAGE.toLowerCase()).not.toContain("try again");
  });

  it("names the file as the problem when no model could take it", () => {
    expect(finalFailureMessage("unsupported-file")).toMatch(/too large or in a format/);
  });

  it("leaves other kinds to the generic message", () => {
    expect(finalFailureMessage("invalid-output")).toBeUndefined();
    expect(finalFailureMessage("constructor")).toBeUndefined();
  });
});

describe("classifyExtractionError", () => {
  it.each(["timeout", "rate-limited", "provider-error"] as const)("retries %s", (kind) => {
    expect(classifyExtractionError(ocrError(kind))).toMatchObject({
      _tag: "RetryableJobError",
      kind,
    });
  });

  // refused and unsupported-file already fell through every model in the chain;
  // re-running it would only pay for the same answers again.
  it.each([
    "invalid-output",
    "bad-image",
    "not-configured",
    "refused",
    "unsupported-file",
  ] as const)("gives up on %s at once", (kind) => {
    expect(classifyExtractionError(ocrError(kind))).toMatchObject({
      _tag: "NonRetryableJobError",
      kind,
    });
  });

  it("retries storage and database errors, not an unreadable stored file or missing config", () => {
    expect(classifyExtractionError(new StorageError({ message: "x" }))._tag).toBe(
      "RetryableJobError",
    );
    expect(classifyExtractionError(new DbError({ message: "x" }))._tag).toBe("RetryableJobError");
    expect(classifyExtractionError(new InvalidInput({ message: "x" }))._tag).toBe(
      "NonRetryableJobError",
    );
    expect(classifyExtractionError(new NotConfigured({ message: "x" }))._tag).toBe(
      "NonRetryableJobError",
    );
  });

  it("carries the longest Retry-After of the chain, and defers when every provider is cooling", () => {
    const limited = ocrError("rate-limited", [
      attempt("rate-limited", 5_000),
      attempt("rate-limited", 30_000),
    ]);
    expect(classifyExtractionError(limited)).toMatchObject({ retryAfterMs: 30_000 });
    const until = new Date(Date.now() + 60_000);
    expect(classifyExtractionError(new ProvidersCooling({ message: "x", until }))).toMatchObject({
      _tag: "JobDeferred",
      until,
    });
  });
});

describe("provider cooldowns", () => {
  const now = Date.parse("2026-11-06T10:00:00Z");

  it("cools a provider that answered 429, for its Retry-After or a default, capped", () => {
    const error = ocrError("rate-limited", [attempt("rate-limited", 20_000)]);
    expect(cooldownsFrom(error)).toEqual(new Map([["google", 20_000]]));
    expect(cooldownsFrom(ocrError("rate-limited")).get("google")).toBe(30_000);
    const long = ocrError("rate-limited", [attempt("rate-limited", 86_400_000)]);
    expect(cooldownsFrom(long).get("google")).toBe(600_000);
    expect(cooldownsFrom(ocrError("timeout")).size).toBe(0);
  });

  const chain: OcrStep[] = [
    { model: "google:gemini-3.8-flash", enabled: true, timeoutMs: 30_000 },
    { model: "fixture", enabled: true, timeoutMs: 30_000 },
  ];

  it("skips cooling providers, and fails with the earliest end when none is left", async () => {
    const one = new Map([["google" as const, new Date(now + 1_000)]]);
    expect(await Effect.runPromise(withoutCooling(chain, one, now))).toEqual([chain[1]]);
    // Expired cooldowns don't count.
    expect(await Effect.runPromise(withoutCooling(chain, one, now + 2_000))).toEqual(chain);
    const both = new Map([
      ["google" as const, new Date(now + 9_000)],
      ["fixture" as const, new Date(now + 4_000)],
    ]);
    const exit = await Effect.runPromiseExit(withoutCooling(chain, both, now));
    expect(Exit.isFailure(exit) && JSON.stringify(exit.cause)).toContain(
      new Date(now + 4_000).toISOString(),
    );
  });
});

describe("receipt.extract job", () => {
  const payload = {
    receiptId: "0b6f3f8e-8d2a-4c39-9b8f-6f1e2d3c4b5a",
    organizationId: "org",
    userId: "user",
    round: 2,
  };

  it("keys a round so a replay is a no-op, and carries ids only", () => {
    expect(receiptExtractJob(payload, 0)).toMatchObject({
      kind: "receipt.extract",
      idempotencyKey: `receipt:${payload.receiptId}:round:2`,
      maxAttempts: 4,
      receiptId: payload.receiptId,
      userId: "user",
    });
  });

  it("rejects malformed payloads, which the runner sends straight to dead", () => {
    const definition = JOB_REGISTRY["receipt.extract"]!;
    expect(definition.payload.safeParse(payload).success).toBe(true);
    for (const bad of [{ ...payload, receiptId: "x" }, { ...payload, round: 0 }, {}]) {
      expect(receiptExtractPayload.safeParse(bad).success).toBe(false);
    }
  });
});
