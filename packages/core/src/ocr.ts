import {
  classifyOcrError,
  extractReceipt,
  OCR_PROVIDERS,
  OcrCallError,
  retryAfterMs,
  type ExtractionUsage,
  type ExtractReceiptInput,
  type ExtractReceiptResult,
  type ModelId,
  type OcrFailureKind,
  type OcrProviderId,
  type ProviderKeys,
} from "@receipt-ocr/ai";
import { Clock, Config, Context, Effect, Layer, Option } from "effect";
import { NotConfigured, OcrError, ProvidersCooling, type OcrAttempt } from "./errors";
import { providerAvailability, Settings, type OcrRouting, type OcrStep } from "./settings";

/**
 * Budget for the whole chain. The upload route's maxDuration is 60 s; this
 * leaves room for storing the file and writing the result.
 */
export const OCR_DEADLINE_MS = 50_000;

/** Below this, another model can't finish; give up instead of starting one. */
const MIN_STEP_MS = 2_000;

/** Retries inside one model's call; the chain is the main recovery. */
const STEP_MAX_RETRIES = 1;

/**
 * Worth trying the next model: the provider was slow, busy, down or
 * misconfigured, refused, or can't take this file. `invalid-output` and
 * `bad-image` stop the chain: the image is usually the problem, and a second
 * model would cost a second call.
 */
const FALLBACK_KINDS: ReadonlySet<OcrFailureKind> = new Set([
  "timeout",
  "rate-limited",
  "provider-error",
  "not-configured",
  "refused",
  "unsupported-file",
]);

export const providerOf = (model: ModelId): OcrProviderId =>
  model === "fixture" ? "fixture" : (model.slice(0, model.indexOf(":")) as OcrProviderId);

/** The steps that will run, in order: enabled, and with a key on the server. */
export function activeChain(
  routing: OcrRouting,
  available: Record<OcrProviderId, boolean>,
): OcrStep[] {
  return routing.chain.filter((step) => step.enabled && available[providerOf(step.model)] === true);
}

export type OcrResult = ExtractReceiptResult & { attempts: OcrAttempt[] };

export type StepFailure = {
  kind: OcrFailureKind;
  usage: ExtractionUsage | null;
  cause: unknown;
  retryAfterMs?: number;
};

/** Providers cooling down after a 429, and until when; their models are skipped. */
export type ProviderCooldowns = ReadonlyMap<OcrProviderId, Date>;

/**
 * The chain without models whose provider is cooling down. Fails when that
 * leaves nothing, so the caller can wait instead of spending an attempt.
 */
export function withoutCooling(chain: OcrStep[], cooling: ProviderCooldowns, now: number) {
  const coolingNow = (step: OcrStep) => (cooling.get(providerOf(step.model))?.getTime() ?? 0) > now;
  const usable = chain.filter((step) => !coolingNow(step));
  if (usable.length > 0 || chain.length === 0) return Effect.succeed(usable);
  const until = Math.min(...chain.map((step) => cooling.get(providerOf(step.model))!.getTime()));
  return Effect.fail(
    new ProvidersCooling({ message: "Every OCR provider is cooling down", until: new Date(until) }),
  );
}

/** One model call; it must give up by `timeoutMs`. Fails with the classified provider error. */
export type ExtractCall = (input: {
  model: ModelId;
  timeoutMs: number;
  maxRetries: number;
}) => Effect.Effect<ExtractReceiptResult, StepFailure>;

/**
 * Tries each step in order under one shared deadline. A step gets its own
 * timeout or what's left of the deadline, whichever is less.
 */
export const runChain = (
  chain: readonly OcrStep[],
  call: ExtractCall,
  deadlineMs = OCR_DEADLINE_MS,
) =>
  Effect.gen(function* () {
    if (chain.length === 0) {
      return yield* new NotConfigured({ message: "No OCR model is turned on with an API key" });
    }
    const startedAt = yield* Clock.currentTimeMillis;
    const attempts: OcrAttempt[] = [];
    let last: StepFailure = { kind: "timeout", usage: null, cause: undefined };

    for (const [index, step] of chain.entries()) {
      const stepStart = yield* Clock.currentTimeMillis;
      const remaining = deadlineMs - (stepStart - startedAt);
      if (remaining < MIN_STEP_MS) break;
      const outcome = yield* Effect.either(
        call({
          model: step.model,
          timeoutMs: Math.min(step.timeoutMs, remaining),
          maxRetries: STEP_MAX_RETRIES,
        }),
      );
      const ms = (yield* Clock.currentTimeMillis) - stepStart;
      if (outcome._tag === "Right") {
        attempts.push({
          model: step.model,
          step: index,
          kind: "ok",
          ms,
          usage: outcome.right.usage,
        });
        return { ...outcome.right, attempts } satisfies OcrResult;
      }
      last = outcome.left;
      attempts.push({
        model: step.model,
        step: index,
        kind: last.kind,
        ms,
        usage: last.usage,
        ...(last.retryAfterMs === undefined ? {} : { retryAfterMs: last.retryAfterMs }),
      });
      if (!FALLBACK_KINDS.has(last.kind)) break;
    }
    return yield* new OcrError({
      message: "Receipt extraction failed",
      kind: last.kind,
      attempts,
      cause: last.cause,
    });
  });

/** Every provider's key from its `keyEnv`; unset keys are left out. */
const providerKeys: Effect.Effect<ProviderKeys> = Effect.forEach(
  OCR_PROVIDERS.flatMap((p) => (p.keyEnv ? [{ id: p.id, env: p.keyEnv }] : [])),
  ({ id, env }) =>
    Config.option(Config.string(env)).pipe(
      // Trimmed like providerAvailability reads them: a pasted newline isn't part of the key.
      Config.map((value) => [id, Option.getOrUndefined(value)?.trim() || undefined] as const),
      Effect.orElseSucceed(() => [id, undefined] as const),
    ),
).pipe(Effect.map((entries) => Object.fromEntries(entries) as ProviderKeys));

/** Grace on top of the SDK's own timeout, in case a provider ignores the abort. */
const ABORT_GRACE_MS = 1_000;

export class Ocr extends Context.Tag("@receipt-ocr/core/Ocr")<
  Ocr,
  {
    readonly extract: (
      file: ExtractReceiptInput["file"],
      options?: { cooling?: ProviderCooldowns },
    ) => Effect.Effect<OcrResult, OcrError | NotConfigured | ProvidersCooling>;
    /** Fails with NotConfigured when no model can run, so a route can refuse before storing. */
    readonly ready: Effect.Effect<void, NotConfigured>;
  }
>() {
  static readonly Live = Layer.effect(
    Ocr,
    Effect.gen(function* () {
      const settings = yield* Settings;
      const chainNow = Effect.zipWith(settings.ocr, providerAvailability, activeChain);
      return {
        ready: Effect.flatMap(chainNow, (chain) =>
          chain.length > 0
            ? Effect.void
            : Effect.fail(new NotConfigured({ message: "Receipt extraction is not configured" })),
        ),
        extract: (file, options) =>
          Effect.gen(function* () {
            const keys = yield* providerKeys;
            const call: ExtractCall = ({ model, timeoutMs, maxRetries }) =>
              Effect.tryPromise({
                try: (abortSignal) =>
                  extractReceipt({ model, keys, file, timeoutMs, maxRetries, abortSignal }),
                catch: (cause): StepFailure =>
                  cause instanceof OcrCallError
                    ? // The error itself, not its cause: its message never holds receipt contents.
                      {
                        kind: cause.kind,
                        usage: cause.usage,
                        cause,
                        retryAfterMs: retryAfterMs(cause),
                      }
                    : {
                        kind: classifyOcrError(cause),
                        usage: null,
                        cause,
                        retryAfterMs: retryAfterMs(cause),
                      },
              }).pipe(
                Effect.timeoutFail({
                  duration: timeoutMs + ABORT_GRACE_MS,
                  onTimeout: (): StepFailure => ({
                    kind: "timeout",
                    usage: null,
                    cause: "OCR step deadline",
                  }),
                }),
              );
            const chain = yield* withoutCooling(
              yield* chainNow,
              options?.cooling ?? new Map(),
              yield* Clock.currentTimeMillis,
            );
            return yield* runChain(chain, call);
          }),
      };
    }),
  );
}
