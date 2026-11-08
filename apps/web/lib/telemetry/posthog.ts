import "server-only";
import { addEventSink, errorFields, logger } from "@receipt-ocr/core/telemetry";
import { PostHog } from "posthog-node";
import { checkEvent, fromRecord, setProductEventSender, type ProductEvent } from "./analytics";

/**
 * Server-side PostHog: named product events only (`analytics.ts`). No
 * autocapture, no session recording, no browser SDK, no GeoIP, no person
 * properties. Loaded by `register()` only when POSTHOG_KEY is a project key;
 * importing this module is what loads the SDK.
 *
 * Events are queued in memory and sent by the event-sink flush, one `after()`
 * per request, so the response never waits. On Vercel the SDK's own timer is
 * off (`flushInterval: 0`: a frozen function can't run it); the Docker server
 * keeps a 10 s timer and shuts down on SIGTERM.
 */
const FAILURE_NOTICE_MS = 60_000;
let lastFailureNotice = -Infinity;

/** At most one a minute, stdout only (`localOnly`), like the OTLP exporter's. */
export function notePostHogFailure(error: unknown, now = Date.now()): void {
  if (now - lastFailureNotice < FAILURE_NOTICE_MS) return;
  lastFailureNotice = now;
  logger.emit(
    { event: "telemetry.export_failed", unit: "log", kind: "posthog", error: errorFields(error) },
    { level: "error", localOnly: true },
  );
}

export function startPostHog(
  config: { key: string; host: string },
  env: Record<string, string | undefined> = process.env,
  client: Pick<PostHog, "capture" | "flush" | "shutdown" | "on"> = new PostHog(config.key, {
    host: config.host,
    flushAt: 20,
    flushInterval: env.VERCEL === "1" ? 0 : 10_000,
    disableGeoip: true,
    // Sentry owns errors; no AI prompt or output ever goes to PostHog.
    enableExceptionAutocapture: false,
    privacyMode: true,
    requestTimeout: 3_000,
    fetchRetryCount: 1,
  }),
): void {
  const send = (event: ProductEvent) => {
    client.capture({
      distinctId: event.userId,
      event: event.name,
      properties: { ...event.props, $geoip_disable: true },
      ...(event.workspaceId ? { groups: { workspace: event.workspaceId } } : {}),
    });
  };
  // Every failed send, from a sink flush or the SDK's own timer.
  client.on("error", (error) => notePostHogFailure(error));
  setProductEventSender(send);
  addEventSink({
    write: (record) => {
      const event = fromRecord(record);
      const checked = event && checkEvent(event);
      if (checked) send(checked);
    },
    flush: () => client.flush().catch(() => {}),
    shutdown: () => client.shutdown(2_000),
  });
}
