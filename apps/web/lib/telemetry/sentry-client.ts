import {
  BrowserClient,
  breadcrumbsIntegration,
  captureException,
  dedupeIntegration,
  defaultStackParser,
  getCurrentScope,
  globalHandlersIntegration,
  makeFetchTransport,
} from "@sentry/browser";
import { scrubBreadcrumb, scrubEvent } from "./sentry-event";

/**
 * Browser Sentry, errors only, as small as the SDK allows: a bare
 * `BrowserClient` (no `init()` defaults) with the global error handlers,
 * dedupe and navigation/fetch breadcrumbs. No tracing, no Replay, no
 * Feedback, no console or click breadcrumbs. Loaded in its own chunk from
 * `instrumentation-client.ts` only when a DSN was set at build.
 */

let started = false;

export function startSentryClient(dsn: string, release?: string, environment?: string): void {
  if (started) return;
  started = true;
  const client = new BrowserClient({
    dsn,
    release: release || undefined,
    environment: environment || undefined,
    transport: makeFetchTransport,
    stackParser: defaultStackParser,
    integrations: [
      globalHandlersIntegration(),
      dedupeIntegration(),
      breadcrumbsIntegration({
        dom: false,
        sentry: false,
        history: true,
        fetch: true,
        xhr: true,
      }),
    ],
    sendClientReports: false,
    maxBreadcrumbs: 20,
    beforeBreadcrumb: (crumb) => scrubBreadcrumb(crumb),
    beforeSend: (event) => scrubEvent(event),
  });
  getCurrentScope().setClient(client);
  client.init();
}

/** Errors that a React error boundary caught, so they never reached the global handlers. */
export function captureBoundaryError(error: unknown): void {
  if (started) captureException(error);
}
