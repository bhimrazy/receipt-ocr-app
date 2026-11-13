/**
 * Tail sampling: the keep-or-drop decision is made when the unit of work has
 * finished, from its outcome. Errors, slow work and anything that called a
 * model are always kept. Only routine units (fast, successful page renders,
 * polling endpoints, idle queue ticks) are sampled, at `LOG_SAMPLE_RATE`.
 * A sampled line carries `sample_rate`, so counts can be weighted back up
 * (count / sample_rate).
 */

export type SamplingConfig = {
  /** Share of routine events kept, 0 to 1. */
  rate: number;
  /** At or above this duration an event is slow and always kept. */
  slowMs: number;
};

/** Unset: keep everything. Production should set LOG_SAMPLE_RATE=0.1. */
const DEFAULT_RATE = 1;
const DEFAULT_SLOW_MS = 1_000;
/** Floor, so `LOG_SAMPLE_RATE=0` can't erase routine 401s and 429s entirely. */
const MIN_RATE = 0.01;

const parse = (raw: string | undefined, fallback: number, min: number, max: number) => {
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
};

export const samplingFromEnv = (env: Record<string, string | undefined>): SamplingConfig => ({
  rate: parse(env.LOG_SAMPLE_RATE, DEFAULT_RATE, MIN_RATE, 1),
  slowMs: parse(env.LOG_SLOW_MS, DEFAULT_SLOW_MS, 0, Number.MAX_SAFE_INTEGER),
});

type Sampled = {
  level?: unknown;
  status_code?: unknown;
  duration_ms?: unknown;
  error?: unknown;
  ocr?: { calls?: unknown; model?: unknown } | null;
};

/**
 * Client errors that are routine on a routine route: a rate-limited flood
 * (429) and signed-out polls (401). Counting them as errors would let anyone
 * fill the logs. Real errors (5xx, an `error` field, level `error`) and warnings are kept.
 */
const ROUTINE_STATUSES = new Set([401, 429]);

/** Why an event is kept regardless of the rate, or null when it is routine. */
export function alwaysKeepReason(event: Sampled, config: SamplingConfig): string | null {
  if (event.level === "error") return "error";
  if (event.level === "warn") return "warn";
  if (
    typeof event.status_code === "number" &&
    event.status_code >= 400 &&
    !ROUTINE_STATUSES.has(event.status_code)
  ) {
    return "error";
  }
  if (event.error) return "error";
  if (typeof event.duration_ms === "number" && event.duration_ms >= config.slowMs) return "slow";
  if ((typeof event.ocr?.calls === "number" && event.ocr.calls > 0) || event.ocr?.model) {
    return "model_call";
  }
  return null;
}

/**
 * Whether to write a routine event, and at what rate; non-routine events are
 * always written at rate 1.
 */
export function sampleDecision(
  event: Sampled,
  routine: boolean,
  config: SamplingConfig,
  random: () => number = Math.random,
): { keep: boolean; rate: number } {
  if (!routine || config.rate >= 1 || alwaysKeepReason(event, config)) {
    return { keep: true, rate: 1 };
  }
  return { keep: random() < config.rate, rate: config.rate };
}
