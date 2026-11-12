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

describe("a 429 with no Retry-After, then a step that fails for good", () => {
  const G = "google:gemini-3.8-flash";
  const C = "anthropic:claude-haiku-5-5";
  const chain: OcrStep[] = [
    { model: G, enabled: true, timeoutMs: 20_000 },
    { model: C, enabled: true, timeoutMs: 20_000 },
  ];
  const at = (model: string, step: number, kind: OcrError["kind"]) => ({
    model,
    step,
    kind,
    ms: 5,
    usage: null,
  });
  const now = Date.parse("2026-11-07T12:00:00Z");

  it("waits out the cooldown it starts, so the retry includes Gemini again", async () => {
    const first = new OcrError({
      message: "x",
      kind: "unsupported-file",
      attempts: [at(G, 0, "rate-limited"), { ...at(C, 1, "unsupported-file"), skipped: true }],
    });
    const failure = classifyExtractionError(first, now);
    const cooldown = cooldownsFrom(first).get("google")!;
    expect(failure).toMatchObject({ _tag: "RetryableJobError", kind: "rate-limited" });
    if (failure._tag !== "RetryableJobError") return;
    expect(failure.retryAfterMs).toBe(cooldown);
    // Even the shortest jittered delay is past the cooldown, so attempt 2 has Gemini back.
    const delay = backoffMs(1, policy, failure.retryAfterMs, () => 0);
    expect(delay).toBeGreaterThanOrEqual(cooldown);
    const cooling = new Map([["google" as const, new Date(now + cooldown)]]);
    const next = await Effect.runPromise(withoutCooling(chain, cooling, now + delay));
    expect(next.map((step) => step.model)).toEqual([G, C]);
  });

  it("retries when cooling left steps out and the rest failed for good", () => {
    const error = new OcrError({
      message: "x",
      kind: "refused",
      attempts: [at(C, 1, "refused")],
      coolingUntil: new Date(now + 12_000),
    });
    expect(classifyExtractionError(error, now)).toMatchObject({
      _tag: "RetryableJobError",
      kind: "providers-cooling",
      retryAfterMs: 12_000,
    });
  });

  it("still gives up on an all-terminal chain when nothing was cooling", () => {
    const error = new OcrError({
      message: "x",
      kind: "unsupported-file",
      attempts: [at(G, 0, "invalid-output"), { ...at(C, 1, "unsupported-file"), skipped: true }],
    });
    expect(classifyExtractionError(error, now)).toMatchObject({
      _tag: "NonRetryableJobError",
      kind: "unsupported-file",
    });
  });
});

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
  const chainOf = (...kinds: OcrError["kind"][]) =>
    ocrError(
      kinds.at(-1)!,
      kinds.map((kind, step) => ({
        ...attempt(kind, kind === "rate-limited" ? 5_000 : undefined),
        step,
      })),
    );

  it.each([
    [["rate-limited", "unsupported-file"], "rate-limited"],
    [["timeout", "refused"], "timeout"],
    [["provider-error", "bad-image"], "provider-error"],
  ] as const)("retries a chain %j that hit a transient failure first", (kinds, retryKind) => {
    expect(classifyExtractionError(chainOf(...kinds))).toMatchObject({
      _tag: "RetryableJobError",
      kind: retryKind,
    });
  });

  it("keeps the provider's Retry-After when a later step was skipped", () => {
    expect(classifyExtractionError(chainOf("rate-limited", "unsupported-file"))).toMatchObject({
      retryAfterMs: 5_000,
    });
  });

  it.each([
    [["not-configured", "unsupported-file"]],
    [["refused", "refused"]],
    [["unsupported-file", "invalid-output"]],
  ] as const)("gives up on an all-terminal chain %j", (kinds) => {
    expect(classifyExtractionError(chainOf(...kinds))).toMatchObject({
      _tag: "NonRetryableJobError",
      kind: kinds.at(-1),
    });
  });

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

  it("retries a timeout or a lost connection, but not a value or row Postgres refuses", () => {
    const db = (cause: unknown) => classifyExtractionError(new DbError({ message: "x", cause }));
    const pg = (code: string) => Object.assign(new Error("pg"), { code });
    expect(db(new Error("Query read timeout"))._tag).toBe("RetryableJobError");
    expect(db(pg("40001"))._tag).toBe("RetryableJobError");
    expect(db(pg("57014"))._tag).toBe("RetryableJobError");
    expect(db(pg("EPIPE"))._tag).toBe("RetryableJobError");
    for (const code of ["22003", "22P02", "23505", "23514"]) {
      expect(db({ cause: pg(code) })).toMatchObject({
        _tag: "NonRetryableJobError",
        kind: "db-data-error",
      });
    }
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
