import {
  classifyOcrError,
  extractReceipt,
  type ExtractReceiptInput,
  type ExtractReceiptResult,
  type ModelId,
  type OcrFailureKind,
  type OcrProviderId,
} from "@receipt-ocr/ai";
import { Clock, Config, Context, Effect, Layer, Option } from "effect";
import { NotConfigured, OcrError, type OcrAttempt } from "./errors";
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
 * misconfigured. `invalid-output` and `bad-image` stop the chain: the image
 * is usually the problem, and a second model would cost a second call.
 */
const FALLBACK_KINDS: ReadonlySet<OcrFailureKind> = new Set([
  "timeout",
  "rate-limited",
  "provider-error",
  "not-configured",
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

export type StepFailure = { kind: OcrFailureKind; cause: unknown };

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
    let last: StepFailure = { kind: "timeout", cause: undefined };

    for (const step of chain) {
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
        attempts.push({ model: step.model, kind: "ok", ms });
        return { ...outcome.right, attempts } satisfies OcrResult;
      }
      last = outcome.left;
      attempts.push({ model: step.model, kind: last.kind, ms });
      if (!FALLBACK_KINDS.has(last.kind)) break;
    }
    return yield* new OcrError({
      message: "Receipt extraction failed",
      kind: last.kind,
      attempts,
      cause: last.cause,
    });
  });

const googleKey = Config.option(Config.string("GOOGLE_GENERATIVE_AI_API_KEY")).pipe(
  Config.map(Option.getOrUndefined),
  Effect.orElseSucceed(() => undefined),
);

/** Grace on top of the SDK's own timeout, in case a provider ignores the abort. */
const ABORT_GRACE_MS = 1_000;

export class Ocr extends Context.Tag("@receipt-ocr/core/Ocr")<
  Ocr,
  {
    readonly extract: (
      file: ExtractReceiptInput["file"],
    ) => Effect.Effect<OcrResult, OcrError | NotConfigured>;
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
        extract: (file) =>
          Effect.gen(function* () {
            const keys = { google: yield* googleKey };
            const call: ExtractCall = ({ model, timeoutMs, maxRetries }) =>
              Effect.tryPromise({
                try: (abortSignal) =>
                  extractReceipt({ model, keys, file, timeoutMs, maxRetries, abortSignal }),
                catch: (cause): StepFailure => ({ kind: classifyOcrError(cause), cause }),
              }).pipe(
                Effect.timeoutFail({
                  duration: timeoutMs + ABORT_GRACE_MS,
                  onTimeout: (): StepFailure => ({ kind: "timeout", cause: "OCR step deadline" }),
                }),
              );
            return yield* runChain(yield* chainNow, call);
          }),
      };
    }),
  );
}
