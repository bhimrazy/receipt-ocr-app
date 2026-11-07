import { FIXTURE_RECEIPTS, type ModelId, type OcrFailureKind } from "@receipt-ocr/ai";
import { ConfigProvider, Duration, Effect, Exit, Layer, TestClock, TestContext } from "effect";
import { describe, expect, it } from "vitest";
import {
  activeChain,
  Ocr,
  OCR_DEADLINE_MS,
  receiptReaders,
  runChain,
  type ExtractCall,
} from "./ocr";
import { Settings, type OcrStep } from "./settings";

const step = (model: ModelId, timeoutMs = 30_000, enabled = true): OcrStep => ({
  model,
  enabled,
  timeoutMs,
});

/** Classification itself is tested in packages/ai; here only the kind matters. */
const USAGE = {
  inputTokens: 1,
  cachedInputTokens: 0,
  cacheWriteTokens: 0,
  outputTokens: 1,
  reasoningTokens: 0,
};

/** As in packages/ai: only output the model produced (and failed the schema) carries usage. */
const failure = (kind: OcrFailureKind) => ({
  kind,
  usage: kind === "invalid-output" ? USAGE : null,
  cause: new Error(kind),
});

const success = (model: ModelId) =>
  Effect.succeed({
    extraction: FIXTURE_RECEIPTS[0]!,
    usage: USAGE,
    model,
    promptVersion: "v2" as const,
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

describe("receiptReaders", () => {
  const claude = "anthropic:claude-sonnet-5-5" as const;
  const flash = "google:gemini-3.8-flash" as const;
  const lite = "google:gemini-3.5-flash-lite" as const;
  const keys = { google: true, anthropic: true, groq: false, openai: false, fixture: false };

  it("lists friendly labels in chain order, skipping disabled steps and missing keys", () => {
    const chain = [step(claude), step(flash, 30_000, false), step(lite)];
    expect(receiptReaders({ chain }, keys)).toEqual([
      { label: "Claude Sonnet 5.5", provider: "anthropic" },
      { label: "Gemini 3.5 Flash-Lite", provider: "google" },
    ]);
    expect(receiptReaders({ chain }, { ...keys, anthropic: false })).toEqual([
      { label: "Gemini 3.5 Flash-Lite", provider: "google" },
    ]);
    expect(
      receiptReaders(
        { chain },
        { google: false, anthropic: false, groq: false, openai: false, fixture: false },
      ),
    ).toEqual([]);
  });

  it("exposes nothing but label and provider", () => {
    const [reader] = receiptReaders({ chain: [step(flash, 45_000)] }, keys);
    expect(Object.keys(reader!).sort()).toEqual(["label", "provider"]);
  });
});

describe("activeChain", () => {
  it("keeps the saved order and skips disabled steps and providers without a key", () => {
    const chain = [step(B), step(A, 30_000, false), step(F), step("google:model-c")];
    expect(
      activeChain(
        { chain },
        { google: true, anthropic: false, groq: false, openai: false, fixture: false },
      ).map((s) => s.model),
    ).toEqual([B, "google:model-c"]);
    expect(
      activeChain(
        { chain },
        { google: false, anthropic: false, groq: false, openai: false, fixture: true },
      ).map((s) => s.model),
    ).toEqual([F]);
    expect(
      activeChain(
        { chain },
        { google: false, anthropic: false, groq: false, openai: false, fixture: false },
      ),
    ).toEqual([]);
  });

  it("mixes providers in one chain, each gated on its own key", () => {
    const claude = "anthropic:claude-haiku-5-5" as const;
    const chain = [step(A), step(claude)];
    const only = (available: { google: boolean; anthropic: boolean }) =>
      activeChain({ chain }, { ...available, groq: false, openai: false, fixture: false }).map(
        (s) => s.model,
      );
    expect(only({ google: true, anthropic: true })).toEqual([A, claude]);
    expect(only({ google: false, anthropic: true })).toEqual([claude]);
    expect(only({ google: true, anthropic: false })).toEqual([A]);
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

  it.each([
    "timeout",
    "rate-limited",
    "provider-error",
    "not-configured",
    "refused",
    "unsupported-file",
  ] as const)("falls back to the next model on %s", async (error) => {
    const { call, calls } = fakeCall({ [A]: { error } });
    const exit = await run(runChain([step(A), step(B)], call));
    expect(Exit.isSuccess(exit) && exit.value.model).toBe(B);
    expect(calls.map((c) => c.model)).toEqual([A, B]);
    expect(Exit.isSuccess(exit) && exit.value.attempts.map((a) => a.kind)).toEqual([error, "ok"]);
  });

  it("stops on bad-image without paying for a second model", async () => {
    const { call, calls } = fakeCall({ [A]: { error: "bad-image" } });
    const exit = await run(runChain([step(A), step(B)], call));
    expect(calls.map((c) => c.model)).toEqual([A]);
    expect(Exit.isFailure(exit) && JSON.stringify(exit.cause)).toContain('"kind":"bad-image"');
  });

  it("tries the next model after invalid-output", async () => {
    const { call, calls } = fakeCall({ [A]: { error: "invalid-output" } });
    const exit = await run(runChain([step(A), step(B)], call));
    expect(calls.map((c) => c.model)).toEqual([A, B]);
    expect(Exit.isSuccess(exit)).toBe(true);
  });

  it("marks a step skipped before any request on its attempt", async () => {
    const call: ExtractCall = ({ model }) =>
      model === A
        ? Effect.fail({ kind: "unsupported-file", usage: null, cause: undefined, skipped: true })
        : Effect.succeed({
            extraction: FIXTURE_RECEIPTS[0]!,
            usage: USAGE,
            model,
            promptVersion: "v2" as const,
          });
    const exit = await run(runChain([step(A), step(B)], call));
    expect(Exit.isSuccess(exit) && exit.value.attempts).toMatchObject([
      { model: A, kind: "unsupported-file", skipped: true },
      { model: B, kind: "ok" },
    ]);
  });

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

  it("records each call's chain position and usage, known or not", async () => {
    const { call } = fakeCall({ [A]: { error: "rate-limited" } });
    const ok = await run(runChain([step(A), step(B)], call));
    expect(Exit.isSuccess(ok) && ok.value.attempts).toEqual([
      { model: A, step: 0, kind: "rate-limited", ms: 0, usage: null },
      { model: B, step: 1, kind: "ok", ms: 0, usage: USAGE },
    ]);
    const bad = await run(runChain([step(A)], fakeCall({ [A]: { error: "invalid-output" } }).call));
    if (!Exit.isFailure(bad) || bad.cause._tag !== "Fail") throw new Error("expected a failure");
    expect(bad.cause.error._tag === "OcrError" && bad.cause.error.attempts).toEqual([
      { model: A, step: 0, kind: "invalid-output", ms: 0, usage: USAGE },
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

describe("Ocr.Live with a provider cooling down", () => {
  it("says when the left-out provider is back, so a terminal rest can wait for it", async () => {
    const chain = [step("google:gemini-3.8-flash"), step("anthropic:claude-haiku-5-5")];
    const settings = Layer.succeed(Settings, {
      ocr: Effect.succeed({ chain }),
    } as unknown as Settings["Type"]);
    const env = ConfigProvider.fromMap(
      new Map([
        ["GOOGLE_GENERATIVE_AI_API_KEY", "test"],
        ["ANTHROPIC_API_KEY", "test"],
      ]),
    );
    const until = new Date(Date.now() + 60_000);
    // HEIC: Claude skips it before any request, and Gemini is cooling, so nothing reaches a network.
    const heic = { data: new Uint8Array([0, 0, 0, 24]), mediaType: "image/heic" };
    const exit = await Effect.runPromiseExit(
      Effect.flatMap(Ocr, (ocr) =>
        ocr.extract(heic, { cooling: new Map([["google", until]]) }),
      ).pipe(
        Effect.provide(Ocr.Live.pipe(Layer.provide(settings))),
        Effect.withConfigProvider(env),
      ),
    );
    if (!Exit.isFailure(exit) || exit.cause._tag !== "Fail") throw new Error("expected a failure");
    expect(exit.cause.error).toMatchObject({
      _tag: "OcrError",
      kind: "unsupported-file",
      coolingUntil: until,
      attempts: [{ model: "anthropic:claude-haiku-5-5", kind: "unsupported-file", skipped: true }],
    });
  });
});
