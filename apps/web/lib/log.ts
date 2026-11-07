/**
 * The web app's handle on the one logger, which lives in
 * `@receipt-ocr/core/telemetry` so core and a future worker write the same
 * events: the schema and allowlist (`schema.ts`), sampling (`sampling.ts`)
 * and output (`logger.ts`) are documented there.
 */
import type { ErrorFields } from "@receipt-ocr/core/telemetry";

export {
  errorFields,
  logger,
  type ErrorFields,
  type WideEvent,
  type WideEventFields,
} from "@receipt-ocr/core/telemetry";

/**
 * Render failures seen by `onRequestError`, keyed by request id, until the
 * page's own `page.render` event picks them up. On globalThis because
 * instrumentation and the app are bundled separately but share the process.
 */
const failedRenders: Map<string, ErrorFields> = ((
  globalThis as { __receiptOcrFailedRenders?: Map<string, ErrorFields> }
).__receiptOcrFailedRenders ??= new Map());

/** Bounded: a page that never runs `after()` must not leak its entry forever. */
const MAX_FAILED_RENDERS = 500;

export function noteFailedRender(requestId: string, error: ErrorFields): void {
  if (failedRenders.size >= MAX_FAILED_RENDERS) {
    const oldest = failedRenders.keys().next().value;
    if (oldest !== undefined) failedRenders.delete(oldest);
  }
  failedRenders.set(requestId, error);
}

export function takeFailedRender(requestId: string): ErrorFields | undefined {
  const error = failedRenders.get(requestId);
  failedRenders.delete(requestId);
  return error;
}
