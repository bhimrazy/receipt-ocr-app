import { Effect, FiberRefs, Logger, LogLevel } from "effect";
import { CurrentWideEvent } from "./current";
import { sanitize } from "./redact";
import { sampleDecision, samplingFromEnv } from "./sampling";
import type { WideEvent } from "./schema";

/**
 * The one logger. Writes each wide event as one JSON line to stdout (stderr
 * for errors), which is what Vercel and Docker collect, with stable keys:
 * `timestamp` (ISO 8601), `level` (`info`, `warn` or `error`), `event`, the
 * deployment fields, then the event's own fields after the allowlist.
 * Registered sinks (the OTLP exporter in `otlp.ts`, when configured) get the
 * same sampled, sanitised object; see docs/architecture/flows/observability.md.
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
export function deploymentFields(): Environment {
  const env = process.env;
  environment ??= {
    service: env.OTEL_SERVICE_NAME || "web",
    version: env.VERCEL_GIT_COMMIT_SHA || env.GIT_COMMIT_SHA || "local",
    env: env.VERCEL_ENV || env.NODE_ENV || "development",
    region: env.VERCEL_REGION || "local",
    // A random id rather than process.pid, which the Edge runtime (middleware) doesn't have.
    instance: `${env.HOSTNAME || "local"}:${crypto.randomUUID().slice(0, 8)}`,
  };
  return environment;
}

const ERROR_OUTCOMES = new Set(["error", "dead", "lost"]);

/** How serious an event is; `warn` is work that finished but needs a person to look. */
export type LogLevelName = "info" | "warn" | "error";

/** `error` for server failures and jobs that died or lost their lease; `info` otherwise. */
export function levelOf(event: WideEvent): LogLevelName {
  if (event.level === "error" || event.level === "warn" || event.level === "info") {
    return event.level;
  }
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
  level?: LogLevelName;
  /** Stdout only, never the sinks: for a sink reporting its own failure. */
  localOnly?: boolean;
};

/** An event as written: the sanitised fields with timestamp, level, name and deployment. */
export type EventRecord = {
  timestamp: string;
  level: LogLevelName;
  event: string;
} & Record<string, unknown>;

/** Somewhere else events go, besides stdout. `write` must not block or throw. */
export interface EventSink {
  write(record: EventRecord): void;
  flush(): Promise<void>;
  shutdown(): Promise<void>;
}

type SinkState = {
  sinks: Set<EventSink>;
  /** Runs a flush after the current response (Next's `after()`); throws outside a request. */
  scheduler?: () => void;
  flushPending: boolean;
};

/**
 * On globalThis because instrumentation (which registers sinks) and the app
 * are bundled separately but share the process.
 */
const state: SinkState = ((
  globalThis as { __receiptOcrEventSinks?: SinkState }
).__receiptOcrEventSinks ??= { sinks: new Set(), flushPending: false });
const sinks = state.sinks;

/** Adds a sink; returns its removal. */
export function addEventSink(sink: EventSink): () => void {
  sinks.add(sink);
  return () => sinks.delete(sink);
}

/**
 * Sets how a flush is scheduled after the current unit of work: the web app
 * passes `after(flushEventSinks)`. One flush is pending at a time; an event
 * written once it has started schedules the next. Where scheduling throws
 * (outside a request), the sink's own batch timer sends it.
 */
export function setFlushScheduler(scheduler: (() => void) | undefined): void {
  state.scheduler = scheduler;
}

/**
 * Schedules the sinks' flush after the current unit of work, as writing an
 * event does. For sinks fed outside `emit` (product events from `track()`).
 */
export function scheduleFlush(): void {
  requestFlush();
}

function requestFlush() {
  if (sinks.size === 0 || state.flushPending || !state.scheduler) return;
  try {
    state.scheduler();
    state.flushPending = true;
  } catch {
    // Not in a request: the batch timer covers it.
  }
}

const settleWithin = async (work: Promise<unknown>[], timeoutMs: number): Promise<void> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, timeoutMs);
    timer.unref?.();
  });
  await Promise.race([Promise.allSettled(work), timeout]);
  clearTimeout(timer);
};

/** Sends what the sinks hold, giving up after `timeoutMs`. Never rejects. */
export function flushEventSinks(timeoutMs = 2_000): Promise<void> {
  state.flushPending = false;
  if (sinks.size === 0) return Promise.resolve();
  return settleWithin(
    [...sinks].map((sink) => Promise.resolve().then(() => sink.flush())),
    timeoutMs,
  );
}

/** Flushes and closes every sink (SIGTERM on a long-lived server). Never rejects. */
export function shutdownEventSinks(timeoutMs = 5_000): Promise<void> {
  if (sinks.size === 0) return Promise.resolve();
  const closing = [...sinks].map((sink) => Promise.resolve().then(() => sink.shutdown()));
  sinks.clear();
  return settleWithin(closing, timeoutMs);
}

/** Serialises an event as it will be written, or null when sampling drops it. */
export function formatEvent(
  event: LogInput,
  options: EmitOptions = {},
  random: () => number = Math.random,
): { level: LogLevelName; line: string; record: EventRecord } | null {
  const level = options.level ?? levelOf(event);
  const decision = sampleDecision(
    { ...event, level },
    options.routine === true,
    samplingFromEnv(process.env),
    random,
  );
  if (!decision.keep) return null;
  const { fields, dropped, redacted } = sanitize(event);
  delete fields.level;
  const name = typeof fields.event === "string" ? fields.event : "unknown";
  delete fields.event;
  const record: EventRecord = {
    timestamp: new Date().toISOString(),
    level,
    event: name,
    ...deploymentFields(),
    ...fields,
    ...(decision.rate < 1 ? { sample_rate: decision.rate } : {}),
    ...(dropped.length > 0 ? { dropped_fields: dropped } : {}),
    ...(redacted > 0 ? { redacted_secrets: redacted } : {}),
  };
  return { level, line: JSON.stringify(record), record };
}

/** Never throws: logging must not break the request or job it describes. */
function emit(event: LogInput, options?: EmitOptions) {
  try {
    const formatted = formatEvent(event, options);
    if (!formatted) return;
    if (formatted.level === "error") console.error(formatted.line);
    else if (formatted.level === "warn") console.warn(formatted.line);
    else console.info(formatted.line);
    if (options?.localOnly) return;
    for (const sink of sinks) {
      try {
        sink.write(formatted.record);
      } catch {
        // A sink that throws loses this event; stdout already has it.
      }
    }
    if (sinks.size > 0) requestFlush();
  } catch {
    try {
      console.error(
        JSON.stringify({
          timestamp: new Date().toISOString(),
          level: "error",
          event: "log.failed",
        }),
      );
    } catch {
      // Nothing left to report with.
    }
  }
}

export const logger = {
  /** Emits a finished unit of work, its level derived from the outcome. */
  emit,
  info: (event: LogInput) => emit(event, { level: "info" }),
  warn: (event: LogInput) => emit(event, { level: "warn" }),
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
 * to that event's `notices`, and a warning or error raises its level, so the unit still
 * writes one line. Outside one it becomes a standalone `unit: "log"` event,
 * with its fields put through the same allowlist.
 */
export const wideEventLogger = Logger.make(({ logLevel, message, context, annotations }) => {
  const parts = Array.isArray(message) ? message : [message];
  const name = typeof parts[0] === "string" ? parts[0] : "effect.log";
  const level: LogLevelName = LogLevel.greaterThanEqual(logLevel, LogLevel.Error)
    ? "error"
    : LogLevel.greaterThanEqual(logLevel, LogLevel.Warning)
      ? "warn"
      : "info";
  const current = FiberRefs.getOrDefault(context, CurrentWideEvent);
  if (current) {
    current.notices = [...(current.notices ?? []), name];
    if (level === "error" || (level === "warn" && current.level !== "error")) {
      current.level = level;
    }
    return;
  }
  const fields: Record<string, unknown> = {};
  for (const [key, value] of annotations) fields[key] = value;
  for (const part of parts.slice(1)) if (isRecord(part)) Object.assign(fields, part);
  emit({ ...fields, event: name, unit: "log" }, { level });
});

/** Replaces Effect's default (logfmt) logger with `wideEventLogger`. */
export const WideEventLoggerLive = Logger.replace(Logger.defaultLogger, wideEventLogger);
