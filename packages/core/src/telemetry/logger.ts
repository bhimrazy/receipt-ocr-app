import { Effect, FiberRefs, Logger, LogLevel } from "effect";
import { CurrentWideEvent } from "./current";
import { sanitize } from "./redact";
import { sampleDecision, samplingFromEnv } from "./sampling";
import type { WideEvent } from "./schema";

/**
 * The one logger. Writes each wide event as one JSON line to stdout (stderr
 * for errors), which is what Vercel and Docker collect, with stable keys:
 * `timestamp` (ISO 8601), `level` (`info` or `error`), `event`, the
 * deployment fields, then the event's own fields after the allowlist.
 * An OTLP exporter can ship the same object later; see
 * docs/plans/2026-11-06-observability.md.
 */

type Environment = {
  service: string;
  version: string;
  env: string;
  region: string;
  instance: string;
};

let environment: Environment | undefined;

/** Read on first use, so it sees env loaded after import. */
function deployment(): Environment {
  const env = process.env;
  environment ??= {
    service: env.OTEL_SERVICE_NAME || "web",
    version: env.VERCEL_GIT_COMMIT_SHA || env.GIT_COMMIT_SHA || "local",
    env: env.VERCEL_ENV || env.NODE_ENV || "development",
    region: env.VERCEL_REGION || "local",
    instance: `${env.HOSTNAME || "local"}:${process.pid}`,
  };
  return environment;
}

const ERROR_OUTCOMES = new Set(["error", "dead", "lost"]);

/** `error` for server failures and jobs that died or lost their lease; `info` otherwise. */
export function levelOf(event: WideEvent): "info" | "error" {
  if (event.level === "error" || event.level === "info") return event.level;
  if (typeof event.status_code === "number" && event.status_code >= 500) return "error";
  if (event.outcome && ERROR_OUTCOMES.has(event.outcome)) return "error";
  return "info";
}

/**
 * What the logger accepts: a wide event, plus any other keys, which the
 * allowlist drops (and lists in `dropped_fields`) instead of failing the build.
 */
export type LogInput = WideEvent & Record<string, unknown>;

export type EmitOptions = {
  /** Fast, successful, frequent work (page renders, polls): subject to LOG_SAMPLE_RATE. */
  routine?: boolean;
  level?: "info" | "error";
};

/** Serialises an event as it will be written, or null when sampling drops it. */
export function formatEvent(
  event: LogInput,
  options: EmitOptions = {},
  random: () => number = Math.random,
): { level: "info" | "error"; line: string } | null {
  const level = options.level ?? levelOf(event);
  const decision = sampleDecision(
    { ...event, level },
    options.routine === true,
    samplingFromEnv(process.env),
    random,
  );
  if (!decision.keep) return null;
  const { fields, dropped } = sanitize(event);
  delete fields.level;
  const name = fields.event ?? "unknown";
  delete fields.event;
  const line = JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    event: name,
    ...deployment(),
    ...fields,
    ...(decision.rate < 1 ? { sample_rate: decision.rate } : {}),
    ...(dropped.length > 0 ? { dropped_fields: dropped } : {}),
  });
  return { level, line };
}

function emit(event: LogInput, options?: EmitOptions) {
  const formatted = formatEvent(event, options);
  if (!formatted) return;
  if (formatted.level === "error") console.error(formatted.line);
  else console.info(formatted.line);
}

export const logger = {
  /** Emits a finished unit of work, its level derived from the outcome. */
  emit,
  info: (event: LogInput) => emit(event, { level: "info" }),
  error: (event: LogInput) => emit(event, { level: "error" }),
};

/** As an Effect, for code that runs in one. */
export const emitEvent = (event: LogInput, options?: EmitOptions) =>
  Effect.sync(() => emit(event, options));

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Routes `Effect.log*` calls into wide events. Inside a unit of work the
 * message (by convention a code like `receipt.calls_not_recorded`) is added
 * to that event's `notices`, and an error raises its level, so the unit still
 * writes one line. Outside one it becomes a standalone `unit: "log"` event,
 * with its fields put through the same allowlist.
 */
export const wideEventLogger = Logger.make(({ logLevel, message, context, annotations }) => {
  const parts = Array.isArray(message) ? message : [message];
  const name = typeof parts[0] === "string" ? parts[0] : "effect.log";
  const isError = LogLevel.greaterThanEqual(logLevel, LogLevel.Error);
  const current = FiberRefs.getOrDefault(context, CurrentWideEvent);
  if (current) {
    current.notices = [...(current.notices ?? []), name];
    if (isError) current.level = "error";
    return;
  }
  const fields: Record<string, unknown> = {};
  for (const [key, value] of annotations) fields[key] = value;
  for (const part of parts.slice(1)) if (isRecord(part)) Object.assign(fields, part);
  emit({ ...fields, event: name, unit: "log" }, { level: isError ? "error" : "info" });
});

/** Replaces Effect's default (logfmt) logger with `wideEventLogger`. */
export const WideEventLoggerLive = Logger.replace(Logger.defaultLogger, wideEventLogger);
