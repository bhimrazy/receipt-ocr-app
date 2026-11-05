import "server-only";
import type { AppError, AppServices } from "@receipt-ocr/core";
import { getIP } from "better-auth/api";
import { Cause, Effect, Exit, Option } from "effect";
import { NextResponse } from "next/server";
import { authEnv } from "./env";
import { logger, type WideEvent } from "./log";
import { runtime } from "./runtime";

const STATUS: Record<AppError["_tag"], number> = {
  InvalidInput: 400,
  NotFound: 404,
  Conflict: 409,
  QuotaExceeded: 429,
  NotConfigured: 503,
  DbError: 500,
  StorageError: 502,
  OcrError: 502,
};

/** Messages from these are safe to show; the rest are internal and get a generic one. */
const PUBLIC = new Set<AppError["_tag"]>(["InvalidInput", "NotFound", "Conflict", "QuotaExceeded"]);

export const jsonError = (status: number, error: string, headers?: HeadersInit) =>
  NextResponse.json({ error }, { status, headers });

/** The wrapped provider/driver error, which says why (bad key, timeout, SQL). */
function causeDetail(error: { cause?: unknown }): string | undefined {
  const inner = error.cause;
  if (!inner) return undefined;
  return (inner instanceof Error ? `${inner.name}: ${inner.message}` : String(inner)).slice(0, 500);
}

/** Records a failure on the wide event and returns its HTTP response. */
export function failureResponse(cause: Cause.Cause<AppError>, event?: WideEvent): Response {
  const failure = Cause.failureOption(cause);
  if (Option.isNone(failure)) {
    if (event) {
      event.outcome = "error";
      event.status_code = 500;
      event.error = { type: "Defect", detail: Cause.pretty(cause).slice(0, 500) };
    }
    return jsonError(500, "Something went wrong");
  }
  const error = failure.value;
  const status = STATUS[error._tag];
  if (event) {
    event.status_code = status;
    event.outcome = status >= 500 ? "error" : error._tag;
    event.error = { type: error._tag, message: error.message, detail: causeDetail(error) };
  }
  const headers =
    error._tag === "QuotaExceeded" ? { "Retry-After": String(error.retryAfterSeconds) } : undefined;
  const message = PUBLIC.has(error._tag)
    ? error.message
    : error._tag === "NotConfigured"
      ? "This feature is not configured on the server"
      : "Something went wrong. Try again.";
  return jsonError(status, message, headers);
}

/**
 * The one adapter from an Effect program to an HTTP response: runs it on the
 * shared runtime and maps typed failures to status codes.
 */
export async function runRoute<A>(
  program: Effect.Effect<A, AppError, AppServices>,
  onSuccess: (value: A) => Response,
  event?: WideEvent,
): Promise<Response> {
  const exit = await runtime.runPromiseExit(program);
  if (Exit.isSuccess(exit)) return onSuccess(exit.value);
  const response = failureResponse(exit.cause, event);
  if (!event) logFailure(exit.cause);
  return response;
}

/** For `after()` work: runs the program and logs one wide event with its outcome. */
export async function runBackground<A>(
  program: Effect.Effect<A, AppError, AppServices>,
  event: WideEvent,
  onSuccess?: (value: A) => void,
): Promise<void> {
  const startedAt = Date.now();
  const exit = await runtime.runPromiseExit(program);
  event.duration_ms = Date.now() - startedAt;
  if (Exit.isSuccess(exit)) {
    event.outcome = "success";
    onSuccess?.(exit.value);
    logger.info(event);
    return;
  }
  failureResponse(exit.cause, event);
  event.outcome = "error";
  logger.error(event);
}

function logFailure(cause: Cause.Cause<AppError>) {
  const failure = Cause.failureOption(cause);
  if (Option.isSome(failure) && STATUS[failure.value._tag] < 500) return;
  const event: WideEvent = { event: "route.failure" };
  failureResponse(cause, event);
  logger.error(event);
}

const appOrigin = new URL(authEnv.betterAuthUrl).origin;

/**
 * Rejects cross-site mutations. Browsers always send Origin on cross-origin
 * POST/PATCH/DELETE, so a mismatch is a forged request; a missing Origin is a
 * non-browser client, which still needs the session cookie.
 */
export function crossOriginResponse(request: Request): Response | null {
  const origin = request.headers.get("origin");
  if (!origin || origin === appOrigin) return null;
  return jsonError(403, "Cross-origin request rejected");
}

/**
 * The client IP by Better Auth's own rule, so app limiters and auth limiters
 * agree: a configured header with one value, or the right-most hop not in
 * TRUSTED_PROXIES. Never the first X-Forwarded-For entry, which the client
 * controls. Null when no trustworthy IP is available.
 */
export function clientIp(request: Request): string | null {
  return getIP(request, { advanced: { ipAddress: authEnv.ipAddress } });
}

/** Room for multipart boundaries and the other form fields. */
const MULTIPART_OVERHEAD = 64 * 1024;

/**
 * Parses multipart form data without buffering more than `maxFileBytes`
 * (plus overhead): rejects on Content-Length up front, and caps the stream
 * for chunked bodies that don't declare one.
 */
export async function readFormData(
  request: Request,
  maxFileBytes: number,
): Promise<FormData | Response> {
  const limit = maxFileBytes + MULTIPART_OVERHEAD;
  const tooLarge = () =>
    jsonError(413, `Receipt files must be ${maxFileBytes / 1024 / 1024} MB or smaller`);
  const declared = Number(request.headers.get("content-length") ?? "");
  if (declared > limit) return tooLarge();
  if (!request.body) return jsonError(400, "A receipt file is required");

  let received = 0;
  const capped = request.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        received += chunk.byteLength;
        if (received > limit) controller.error(new RangeError("body too large"));
        else controller.enqueue(chunk);
      },
    }),
  );
  try {
    return await new Response(capped, { headers: request.headers }).formData();
  } catch {
    if (received > limit) return tooLarge();
    return jsonError(400, "Invalid upload");
  }
}
