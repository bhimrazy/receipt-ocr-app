import { FIXTURE_RECEIPTS, type ModelId, type OcrFailureKind } from "@receipt-ocr/ai";
import { Duration, Effect, Exit, TestClock, TestContext } from "effect";
import { describe, expect, it } from "vitest";
import { activeChain, OCR_DEADLINE_MS, runChain, type ExtractCall } from "./ocr";
import type { OcrStep } from "./settings";

const step = (model: ModelId, timeoutMs = 30_000, enabled = true): OcrStep => ({
  model,
  enabled,
  timeoutMs,
});

/** Classification itself is tested in packages/ai; here only the kind matters. */
const failure = (kind: OcrFailureKind) => ({ kind, cause: new Error(kind) });

const success = (model: ModelId) =>
  Effect.succeed({
    extraction: FIXTURE_RECEIPTS[0]!,
    usage: { inputTokens: 1, cachedInputTokens: 0, outputTokens: 1, reasoningTokens: 0 },
    model,
  });

/** A fake provider per model: fail with the given error (after `ms` of test time) or succeed. */
function fakeCall(plan: Partial<Record<ModelId, { error?: OcrFailureKind; ms?: number }>>) {
  const calls: { model: ModelId; timeoutMs: number; maxRetries: number }[] = [];
  const call: ExtractCall = (input) =>
    Effect.gen(function* () {
      calls.push(input);
      const outcome = plan[input.model] ?? {};
      if (outcome.ms) yield* TestClock.adjust(Duration.millis(outcome.ms));
      if (outcome.error) return yield* Effect.fail(failure(outcome.error));
      return yield* success(input.model);
    });
  return { call, calls };
}

const run = <A, E>(effect: Effect.Effect<A, E>) =>
  Effect.runPromiseExit(effect.pipe(Effect.provide(TestContext.TestContext)));

const A = "google:model-a" as const;
const B = "google:model-b" as const;
const F = "fixture" as const;

describe("activeChain", () => {
  it("keeps the saved order and skips disabled steps and providers without a key", () => {
    const chain = [step(B), step(A, 30_000, false), step(F), step("google:model-c")];
    expect(activeChain({ chain }, { google: true, fixture: false }).map((s) => s.model)).toEqual([
      B,
      "google:model-c",
    ]);
    expect(activeChain({ chain }, { google: false, fixture: true }).map((s) => s.model)).toEqual([
      F,
    ]);
    expect(activeChain({ chain }, { google: false, fixture: false })).toEqual([]);
  });
});

describe("runChain", () => {
  it("answers with the first model when it succeeds, and calls no other", async () => {
    const { call, calls } = fakeCall({});
    const exit = await run(runChain([step(A), step(B)], call));
    expect(Exit.isSuccess(exit) && exit.value.model).toBe(A);
    expect(calls.map((c) => c.model)).toEqual([A]);
    expect(calls[0]?.maxRetries).toBe(1);
  });

  it.each(["timeout", "rate-limited", "provider-error", "not-configured"] as const)(
    "falls back to the next model on %s",
    async (error) => {
      const { call, calls } = fakeCall({ [A]: { error } });
      const exit = await run(runChain([step(A), step(B)], call));
      expect(Exit.isSuccess(exit) && exit.value.model).toBe(B);
      expect(calls.map((c) => c.model)).toEqual([A, B]);
      expect(Exit.isSuccess(exit) && exit.value.attempts.map((a) => a.kind)).toEqual([error, "ok"]);
    },
  );

  it.each(["invalid-output", "bad-image"] as const)(
    "stops on %s without paying for a second model",
    async (kind) => {
      const { call, calls } = fakeCall({ [A]: { error: kind } });
      const exit = await run(runChain([step(A), step(B)], call));
      expect(calls.map((c) => c.model)).toEqual([A]);
      expect(Exit.isFailure(exit) && JSON.stringify(exit.cause)).toContain(`"kind":"${kind}"`);
    },
  );

  it("fails with every attempt listed when all models fail", async () => {
    const { call } = fakeCall({ [A]: { error: "provider-error" }, [B]: { error: "rate-limited" } });
    const exit = await run(runChain([step(A), step(B)], call));
    if (!Exit.isFailure(exit) || exit.cause._tag !== "Fail") throw new Error("expected a failure");
    const error = exit.cause.error;
    expect(error._tag).toBe("OcrError");
    if (error._tag !== "OcrError") return;
    expect(error.kind).toBe("rate-limited");
    expect(error.attempts.map((a) => [a.model, a.kind])).toEqual([
      [A, "provider-error"],
      [B, "rate-limited"],
    ]);
  });

  it("gives each step what is left of the shared deadline", async () => {
    const { call, calls } = fakeCall({
      [A]: { error: "provider-error", ms: 30_000 },
      [B]: { error: "provider-error", ms: 15_000 },
    });
    await run(runChain([step(A, 30_000), step(B, 30_000), step(F, 30_000)], call));
    expect(calls.map((c) => c.timeoutMs)).toEqual([
      30_000,
      OCR_DEADLINE_MS - 30_000,
      OCR_DEADLINE_MS - 45_000,
    ]);
  });

  it("does not start a model once the deadline is nearly spent", async () => {
    const { call, calls } = fakeCall({
      [A]: { error: "provider-error", ms: OCR_DEADLINE_MS - 500 },
    });
    const exit = await run(runChain([step(A, 50_000), step(B)], call));
    expect(calls.map((c) => c.model)).toEqual([A]);
    expect(Exit.isFailure(exit)).toBe(true);
  });

  it("is not configured when no model can run", async () => {
    const { call } = fakeCall({});
    const exit = await run(runChain([], call));
    expect(Exit.isFailure(exit) && JSON.stringify(exit.cause)).toContain("NotConfigured");
  });
});
