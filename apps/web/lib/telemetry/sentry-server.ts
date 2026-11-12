import "server-only";
import * as Sentry from "@sentry/node";
import { addEventSink, type EventRecord } from "@receipt-ocr/core/telemetry";
import { setErrorReporter, type ErrorReport } from "./errors";
import { sentryEnvironment, sentryRelease } from "./sentry-config";
import { scrubEvent } from "./sentry-event";

/**
 * Server-side Sentry, errors only. Loaded by `register()` only when SENTRY_DSN
 * is a valid DSN; importing this module is what loads the SDK.
 *
 * - No tracing, no OpenTelemetry provider, no module hooks, no default
 *   integrations: just uncaught exceptions, unhandled rejections and the
 *   errors we report (`reportError`), so cold start and requests pay nothing
 *   until an error happens.
 * - Every event is rebuilt from an allowlist (`scrubEvent`), and the errors we
 *   report are synthetic: our error fields and the original stack frames,
 *   never the original message or cause chain (security plan B1).
 * - Sending is asynchronous; the event-sink flush (one `after()` per request)
 *   waits for it, so a Vercel function doesn't freeze with an error unsent.
 */

const NO_DATA: Sentry.NodeOptions["dataCollection"] = {
  userInfo: false,
  cookies: false,
  httpHeaders: false,
  httpBodies: [],
  urlQueryParams: false,
  graphQL: { document: false, variables: false },
  genAI: { inputs: false, outputs: false },
  mcp: { inputs: false, outputs: false },
  databaseQueryData: false,
  queues: false,
  stackFrameVariables: false,
  frameContextLines: 0,
};

/** Only the frames of a stack, so no message line (which can hold data) comes with them. */
export function framesOf(error: unknown): string {
  try {
    const stack = error instanceof Error ? error.stack : undefined;
    return (stack ?? "")
      .split("\n")
      .filter((line) => /^\s+at /.test(line))
      .slice(0, 50)
      .join("\n");
  } catch {
    return "";
  }
}

/** A stand-in error named after our error fields, with the original's frames. */
export function syntheticError(report: ErrorReport): Error {
  const { fields } = report;
  const name = fields.type ?? fields.class ?? "Error";
  const message = [fields.kind, fields.code].filter(Boolean).join(":") || name;
  const error = new Error(message);
  error.name = name;
  const frames = framesOf(report.error);
  error.stack = frames ? `${name}: ${message}\n${frames}` : `${name}: ${message}`;
  return error;
}

const toTags = (report: ErrorReport) => {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries({
    ...report.tags,
    error_type: report.fields.type,
    error_kind: report.fields.kind,
    error_code: report.fields.code,
    digest: report.fields.digest,
  })) {
    if (value !== undefined && value !== null) out[key] = String(value);
  }
  return out;
};

/** Dead jobs have no request and no thrown error left; their event is the report. */
function captureDeadJob(record: EventRecord) {
  const queue = record.queue as
    { outcome?: string; kind?: string; error_kind?: string } | undefined;
  if (record.unit !== "job_attempt" || queue?.outcome !== "dead") return;
  Sentry.captureMessage(`job_dead:${queue.kind ?? "unknown"}:${queue.error_kind ?? "unknown"}`, {
    level: "error",
    tags: { event: String(record.event) },
    fingerprint: ["job_dead", queue.kind ?? "unknown", queue.error_kind ?? "unknown"],
  });
}

export function startSentryServer(
  dsn: string,
  env: Record<string, string | undefined> = process.env,
  /** For tests: where envelopes go instead of Sentry. */
  transport?: Sentry.NodeOptions["transport"],
): void {
  Sentry.init({
    dsn,
    ...(transport ? { transport } : {}),
    // Inlined at build (next.config.ts), so server and browser report the release the source maps
    // were uploaded under.
    release: process.env.NEXT_PUBLIC_SENTRY_RELEASE || sentryRelease(env),
    environment: sentryEnvironment(env),
    enableOpenTelemetrySetup: false,
    enableRuntimeChannelInjection: false,
    defaultIntegrations: false,
    integrations: [
      Sentry.onUncaughtExceptionIntegration(),
      Sentry.onUnhandledRejectionIntegration(),
      Sentry.dedupeIntegration(),
    ],
    dataCollection: NO_DATA,
    sendClientReports: false,
    maxBreadcrumbs: 0,
    beforeSend: (event) => scrubEvent(event),
    beforeSendTransaction: () => null,
  });
  setErrorReporter((report) => {
    Sentry.captureException(syntheticError(report), { level: "error", tags: toTags(report) });
  });
  addEventSink({
    write: captureDeadJob,
    flush: async () => {
      await Sentry.flush(2_000);
    },
    shutdown: async () => {
      await Sentry.close(2_000);
    },
  });
}
