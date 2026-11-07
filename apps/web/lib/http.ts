import "server-only";
import type { AppError, AppServices } from "@receipt-ocr/core";
import { getIP } from "better-auth/api";
import { Cause, Effect, Exit, Option } from "effect";
import { NextResponse } from "next/server";
import { authEnv } from "./env";
import { logger, redactDbMessage, type WideEvent } from "./log";
import { runtime } from "./runtime";

const STATUS: Record<AppError["_tag"], number> = {
  InvalidInput: 400,
  NotFound: 404,
  Forbidden: 403,
  Conflict: 409,
  QuotaExceeded: 429,
  NotConfigured: 503,
  DbError: 500,
  StorageError: 502,
  OcrError: 502,
};

/** Messages from these are safe to show; the rest are internal and get a generic one. */
const PUBLIC = new Set<AppError["_tag"]>([
  "InvalidInput",
  "NotFound",
  "Forbidden",
  "Conflict",
  "QuotaExceeded",
]);

export const jsonError = (status: number, error: string, headers?: HeadersInit) =>
  NextResponse.json({ error }, { status, headers });

/**
 * The wrapped provider/driver error, which says why (bad key, timeout, SQL).
 * Drizzle appends the bound `params:` (user text such as merchant names) to a
 * failed query's message; those stay out of logs.
 */
export function causeDetail(error: { cause?: unknown }): string | undefined {
  const inner = error.cause;
  if (!inner) return undefined;
  const detail = inner instanceof Error ? `${inner.name}: ${inner.message}` : String(inner);
  return redactDbMessage(detail);
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
    if (error._tag === "OcrError") event.ocr = { kind: error.kind, attempts: error.attempts };
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

function logFailure(cause: Cause.Cause<AppError>) {
  const failure = Cause.failureOption(cause);
  if (Option.isSome(failure) && STATUS[failure.value._tag] < 500) return;
  const event: WideEvent = { event: "route.failure" };
  failureResponse(cause, event);
  logger.error(event);
}

const appOrigins = new Set(authEnv.trustedOrigins);

/**
 * Rejects cross-site mutations. Browsers send Origin on every POST, PATCH and
 * DELETE, so these routes require it to be the app's own; a request without
 * one is refused rather than assumed to be same-site.
 */
export function crossOriginResponse(request: Request): Response | null {
  const origin = request.headers.get("origin");
  if (origin && appOrigins.has(origin)) return null;
  return jsonError(403, "Cross-origin request rejected");
}

/**
 * The client IP by Better Auth's own rule, so app limiters and auth limiters
 * agree: a configured header with one value, or the right-most hop not in
 * TRUSTED_PROXIES. Never the first X-Forwarded-For entry, which the client
 * controls. Null when no trustworthy IP is available.
 */
export function clientIp(request: { headers: Headers }): string | null {
  const ip = getIP(request.headers, { advanced: { ipAddress: authEnv.ipAddress } });
  if (ip === null && !warnedNoClientIp && process.env.NODE_ENV === "production") {
    const headers = authEnv.ipAddress.ipAddressHeaders ?? ["x-forwarded-for"];
    const hops = headers.map((h) => request.headers.get(h)?.split(",").length ?? 0);
    if (hops.some((n) => n > 0)) {
      // Every such client shares one rate-limit bucket, so a few bad sign-ins lock everyone out.
      warnedNoClientIp = true;
      logger.error({
        event: "http.client_ip_unresolved",
        message:
          "No client IP from the trusted header. If your proxy appends to it, list the proxy in TRUSTED_PROXIES.",
        headers: headers.join(","),
        hops: hops.join(","),
      });
    }
  }
  return ip;
}

let warnedNoClientIp = false;

/** For early returns: cancels an unread request body so the runtime stops receiving it. */
export function discardBody(request: Request, response: Response): Response {
  if (request.body && !request.bodyUsed) request.body.cancel().catch(() => {});
  return response;
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
