import { SeverityNumber, type AttributeValue, type Attributes } from "@opentelemetry/api";
import { detectResources, envDetector, resourceFromAttributes } from "@opentelemetry/resources";
import {
  BatchLogRecordProcessor,
  LoggerProvider,
  type LogRecordExporter,
} from "@opentelemetry/sdk-logs";
import { addEventSink, deploymentFields, logger, type EventRecord, type EventSink } from "./logger";
import { otlpLogsProtocol } from "./otlp-config";
import { errorFields } from "./redact";

/**
 * Ships wide events as OTLP log records, through the standard OpenTelemetry
 * env (`OTEL_EXPORTER_OTLP_ENDPOINT`, `_HEADERS`, `_PROTOCOL`,
 * `OTEL_RESOURCE_ATTRIBUTES`). Load it only when `otlpLogsConfigured` is true:
 * importing this module is what loads the SDK.
 *
 * Records are buffered and sent in batches off the request path; serverless
 * callers flush in `after()` (`flushEventSinks`). A failed export never fails
 * the work being logged and is reported on stderr at most once a minute.
 */

/** Deployment fields become resource attributes instead of per-record ones. */
const RESOURCE_KEYS = {
  service: "service.name",
  version: "service.version",
  env: "deployment.environment.name",
  region: "cloud.region",
  instance: "service.instance.id",
} as const;

const MAX_DEPTH = 4;

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && Object.getPrototypeOf(value) === Object.prototype;

const isPrimitive = (value: unknown): value is string | number | boolean =>
  typeof value === "string" || typeof value === "number" || typeof value === "boolean";

/** Nested groups become dotted keys (`ocr.tokens_in`); lists of objects a JSON string. */
export function flattenAttributes(
  fields: Record<string, unknown>,
  prefix = "",
  out: Attributes = {},
  depth = 0,
): Attributes {
  for (const [key, value] of Object.entries(fields)) {
    const name = prefix ? `${prefix}.${key}` : key;
    if (value === null || value === undefined) continue;
    if (isPrimitive(value)) out[name] = value;
    else if (Array.isArray(value)) {
      const first = value[0];
      const uniform =
        value.length > 0 && isPrimitive(first) && value.every((v) => typeof v === typeof first);
      out[name] = uniform ? (value as AttributeValue) : JSON.stringify(value);
    } else if (isPlainObject(value) && depth < MAX_DEPTH) {
      flattenAttributes(value, name, out, depth + 1);
    }
  }
  return out;
}

/** One wide event as an OTLP log record (plan: "Mapping a wide event to an OTLP log record"). */
export function toLogRecord(record: EventRecord) {
  const { timestamp, level, event, ...rest } = record;
  for (const key of Object.keys(RESOURCE_KEYS)) delete rest[key];
  return {
    timestamp: new Date(timestamp),
    severityNumber: level === "error" ? SeverityNumber.ERROR : SeverityNumber.INFO,
    severityText: level,
    eventName: event,
    body: event,
    attributes: flattenAttributes(rest),
  };
}

const FAILURE_NOTICE_MS = 60_000;
let lastFailureNotice = 0;

/** Stdout only (`localOnly`), so a failing endpoint can't feed itself. */
function noteExportFailure(error: unknown, now = Date.now()) {
  if (now - lastFailureNotice < FAILURE_NOTICE_MS) return;
  lastFailureNotice = now;
  logger.emit(
    { event: "telemetry.export_failed", unit: "log", kind: "otlp", error: errorFields(error) },
    { level: "error", localOnly: true },
  );
}

/** ExportResultCode.SUCCESS in @opentelemetry/core. */
const EXPORT_SUCCESS = 0;

function reportingFailures(exporter: LogRecordExporter): LogRecordExporter {
  return {
    export(records, done) {
      exporter.export(records, (result) => {
        if (result.code !== EXPORT_SUCCESS) noteExportFailure(result.error);
        done(result);
      });
    },
    shutdown: () => exporter.shutdown(),
    forceFlush: () => exporter.forceFlush(),
  };
}

async function createExporter(env: Record<string, string | undefined>): Promise<LogRecordExporter> {
  // Endpoint and headers come from the standard env; only the bundled protocols are offered.
  const config = { timeoutMillis: 5_000 };
  if (otlpLogsProtocol(env) === "http/json") {
    const { OTLPLogExporter } = await import("@opentelemetry/exporter-logs-otlp-http");
    return new OTLPLogExporter(config);
  }
  const { OTLPLogExporter } = await import("@opentelemetry/exporter-logs-otlp-proto");
  return new OTLPLogExporter(config);
}

let started: EventSink | undefined;

/**
 * Registers the OTLP sink once per process and returns it. `exporter` is for
 * tests; by default it is built from the env.
 */
export async function startOtlpExport(
  options: { env?: Record<string, string | undefined>; exporter?: LogRecordExporter } = {},
): Promise<EventSink> {
  if (started) return started;
  const env = options.env ?? process.env;
  const exporter = reportingFailures(options.exporter ?? (await createExporter(env)));
  const deployment = deploymentFields();
  const ours = resourceFromAttributes(
    Object.fromEntries(
      Object.entries(RESOURCE_KEYS).map(([field, attribute]) => [
        attribute,
        deployment[field as keyof typeof RESOURCE_KEYS],
      ]),
    ),
  );
  // OTEL_RESOURCE_ATTRIBUTES and OTEL_SERVICE_NAME win over the defaults above.
  const resource = ours.merge(detectResources({ detectors: [envDetector] }));
  const provider = new LoggerProvider({
    resource,
    processors: [
      new BatchLogRecordProcessor({
        exporter,
        // Small enough to send in one request per flush on a typical request.
        maxExportBatchSize: 512,
        maxQueueSize: 2_048,
        scheduledDelayMillis: 1_000,
        exportTimeoutMillis: 5_000,
      }),
    ],
  });
  const otelLogger = provider.getLogger("receipt-ocr");
  const sink: EventSink = {
    write: (record) => otelLogger.emit(toLogRecord(record)),
    flush: () => provider.forceFlush({ timeoutMillis: 2_000 }),
    shutdown: () => provider.shutdown(),
  };
  addEventSink(sink);
  started = sink;
  return sink;
}
