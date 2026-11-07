import "server-only";
import { withWideEvent, type AppError, type AppServices } from "@receipt-ocr/core";
import { getIP } from "better-auth/api";
import { Cause, Effect, Exit, Option } from "effect";
import { NextResponse } from "next/server";
import { authEnv } from "./env";
import { errorFields, logger, type WideEvent } from "./log";
import { REQUEST_ID_HEADER } from "./request-id";
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
 * Records a failure on the wide event and returns its HTTP response. The
 * event gets the error's tag, kind and cause class, never its message:
 * provider and Drizzle messages can carry receipt data and bound `params:`.
 */
export function failureResponse(cause: Cause.Cause<AppError>, event?: WideEvent): Response {
  const failure = Cause.failureOption(cause);
  if (Option.isNone(failure)) {
    if (event) {
      event.outcome = "error";
      event.status_code = 500;
      event.error = { ...errorFields(Cause.squash(cause)), type: "Defect" };
    }
    return jsonError(500, "Something went wrong");
  }
  const error = failure.value;
  const status = STATUS[error._tag];
  if (event) {
    event.status_code = status;
    event.outcome = status >= 500 ? "error" : error._tag;
    event.error = errorFields(error);
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
 * shared runtime and maps typed failures to status codes. With `event`, the
 * program runs with it as the current wide event, so core code can annotate
 * it (`annotateEvent`).
 */
export async function runRoute<A>(
  program: Effect.Effect<A, AppError, AppServices>,
  onSuccess: (value: A) => Response,
  event?: WideEvent,
): Promise<Response> {
  const exit = await runtime.runPromiseExit(event ? program.pipe(withWideEvent(event)) : program);
  if (Exit.isSuccess(exit)) return onSuccess(exit.value);
  const response = failureResponse(exit.cause, event);
  if (!event) logFailure(exit.cause);
  return response;
}

/** For callers without a wide event (server actions): 5xx and defects only. */
function logFailure(cause: Cause.Cause<AppError>) {
  const failure = Cause.failureOption(cause);
  if (Option.isSome(failure) && STATUS[failure.value._tag] < 500) return;
  const event: WideEvent = { event: "route.failure", unit: "log" };
  failureResponse(cause, event);
  logger.error(event);
}

type RequestEventSpec = {
  /** What the request does: `receipt.upload`, `receipt.status`. */
  event: string;
  /** The route pattern, never the raw path: `/api/receipts/[id]`. */
  route: string;
  /** Frequent, cheap requests (polls, health checks): sampled at LOG_SAMPLE_RATE when fast and successful. */
  routine?: boolean;
};

/**
 * Middleware for route handlers: one wide event per request. It sets the
 * request id, route, method, status, duration and outcome, and writes the
 * event once in `finally`; the handler adds business context (ids, plan,
 * mode) to the `event` it is given and passes it to `runRoute`. The response
 * carries the id as `x-request-id`, so a user's report can be found in the logs.
 */
export function withRequestEvent<C = unknown>(
  spec: RequestEventSpec,
  handler: (request: Request, context: C, event: WideEvent) => Promise<Response> | Response,
): (request: Request, context?: C) => Promise<Response> {
  return async (request, context) => {
    const startedAt = Date.now();
    const event: WideEvent = {
      event: spec.event,
      unit: "request",
      route: spec.route,
      method: request.method,
      request_id: crypto.randomUUID(),
    };
    try {
      const response = await handler(request, context as C, event);
      event.status_code ??= response.status;
      try {
        response.headers.set(REQUEST_ID_HEADER, event.request_id!);
      } catch {
        // A response with immutable headers (a proxied fetch) keeps its own.
      }
      return response;
    } catch (error) {
      // Next's redirect() and notFound() also throw; they still end the request.
      event.status_code ??= 500;
      event.error ??= errorFields(error);
      throw error;
    } finally {
      event.duration_ms = Date.now() - startedAt;
      const status = event.status_code ?? 500;
      event.outcome ??= status >= 500 ? "error" : status >= 400 ? "rejected" : "ok";
      logger.emit(event, { routine: spec.routine === true });
    }
  };
}

/** The caller's ids on the event. Requests made while impersonating carry the admin's id. */
export function annotateCaller(
  event: WideEvent,
  caller: {
    session?: { user: { id: string }; session: { impersonatedBy?: string | null } } | null;
    scope?: { userId: string; organizationId: string } | null;
  },
): void {
  event.user_id = caller.scope?.userId ?? caller.session?.user.id ?? event.user_id;
  event.organization_id = caller.scope?.organizationId ?? event.organization_id;
  const impersonatedBy = caller.session?.session.impersonatedBy;
  if (impersonatedBy) event.impersonated_by = impersonatedBy;
}

const appOrigin = new URL(authEnv.betterAuthUrl).origin;

/**
 * Rejects cross-site mutations. Browsers send Origin on every POST, PATCH and
 * DELETE, so these routes require it to be the app's own; a request without
 * one is refused rather than assumed to be same-site.
 */
export function crossOriginResponse(request: Request): Response | null {
  if (request.headers.get("origin") === appOrigin) return null;
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
      // No client IP from the trusted header: if the proxy appends to it, list it in TRUSTED_PROXIES.
      logger.error({
        event: "http.client_ip_unresolved",
        unit: "log",
        flags: Object.fromEntries(headers.map((h, i) => [h, hops[i] ?? 0])),
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
