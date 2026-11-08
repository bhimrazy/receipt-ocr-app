import type { ErrorFields } from "@receipt-ocr/core/telemetry";

/**
 * Where server failures are reported beyond the logs (Sentry, when
 * configured). Call sites hand over the error and the fields already on the
 * wide event; without a reporter registered this is one property read.
 */
export type ErrorReport = {
  error: unknown;
  /** From `errorFields(error)`: type, class, kind, code, digest. Never a message. */
  fields: ErrorFields;
  /** Short codes only: route pattern, route type, method, request id, status. */
  tags?: Record<string, string | number | undefined | null>;
};

type Reporter = (report: ErrorReport) => void;

// On globalThis: instrumentation registers it, the app's bundle calls it.
const slot = globalThis as { __receiptOcrErrorReporter?: Reporter };

export function setErrorReporter(reporter: Reporter | undefined): void {
  slot.__receiptOcrErrorReporter = reporter;
}

/** Never throws: reporting must not change the response. */
export function reportError(report: ErrorReport): void {
  const reporter = slot.__receiptOcrErrorReporter;
  if (!reporter) return;
  try {
    reporter(report);
  } catch {
    // The wide event already has the failure.
  }
}
