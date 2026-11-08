import "server-only";
import { hitRateLimit, withWideEvent, type AppError, type AppServices } from "@receipt-ocr/core";
import { getIP } from "better-auth/api";
import { Cause, Effect, Exit, Option } from "effect";
import { NextResponse } from "next/server";
import { authEnv } from "./env";
import { errorFields, logger, type ErrorFields, type WideEvent } from "./log";
import { REQUEST_ID_HEADER } from "./request-id";
import { runtime } from "./runtime";
import { reportError } from "./telemetry/errors";

const STATUS: Record<AppError["_tag"], number> = {
  InvalidInput: 400,
  NotFound: 404,
  Forbidden: 403,
  Conflict: 409,
  QuotaExceeded: 429,
  NotConfigured: 503,
  DbError: 500,
  StorageError: 502,
  BillingProviderError: 502,
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

/** Server failures (5xx and defects) go to error reporting too; expected 4xx never do. */
function report(error: unknown, fields: ErrorFields, status: number, event?: WideEvent) {
  reportError({
    error,
    fields,
    tags: {
      route: event?.route,
      method: event?.method,
      request_id: event?.request_id,
      event: event?.event,
      status_code: status,
    },
  });
}

/** OCR failures the photo caused (unreadable, declined, wrong file): logged, not reported. */
const PHOTO_FAILURES = new Set(["invalid-output", "bad-image", "refused", "unsupported-file"]);
const userInputFailure = (error: AppError) =>
  error._tag === "OcrError" && PHOTO_FAILURES.has(error.kind);

/**
 * Records a failure on the wide event and returns its HTTP response. The
 * event gets the error's tag, kind and cause class, never its message:
 * provider and Drizzle messages can carry receipt data and bound `params:`.
 */
export function failureResponse(cause: Cause.Cause<AppError>, event?: WideEvent): Response {
  const failure = Cause.failureOption(cause);
  if (Option.isNone(failure)) {
    const defect = Cause.squash(cause);
    const fields: ErrorFields = { ...errorFields(defect), type: "Defect" };
    if (event) {
      event.outcome = "error";
      event.status_code = 500;
      event.error = fields;
    }
    report(defect, fields, 500, event);
    return jsonError(500, "Something went wrong");
  }
  const error = failure.value;
  const status = STATUS[error._tag];
  const fields = errorFields(error);
  if (event) {
    event.status_code = status;
    event.outcome = status >= 500 ? "error" : error._tag;
    event.error = fields;
  }
  if (status >= 500 && !userInputFailure(error)) report(error, fields, status, event);
  const headers =
    error._tag === "QuotaExceeded" ? { "Retry-After": String(error.retryAfterSeconds) } : undefined;
  const message = PUBLIC.has(error._tag)
    ? error.message
    : error._tag === "NotConfigured"
      ? "This feature isn't available right now."
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
  /**
   * Frequent, cheap requests (polls, health checks): sampled at
   * LOG_SAMPLE_RATE when fast and successful. A predicate decides per request
   * (auth: only session reads are routine, never a callback or a reset).
   */
  routine?: boolean | ((request: Request) => boolean);
  /**
   * Keep every 429 instead of sampling it: endpoints where a run of rejections
   * is the signal (sign-in, sign-up, password reset, the contact form).
   */
  keepRateLimited?: boolean;
};

/** Events a handler chose not to write (a rate limiter rejecting a flood). */
const skipped = new WeakSet<WideEvent>();

/**
 * Drops this request's event. For limiter rejections on endpoints anyone can
 * hit (CSP reports), where logging each rejection would be the flood.
 */
export function skipEvent(event: WideEvent): void {
  skipped.add(event);
}

/** Plan-quota rejections kept per user per minute; the rest of a burst is sampled. */
export const QUOTA_REJECTIONS_KEPT = 3;

/**
 * Whether this plan-quota 429 is one of the user's first few this minute. A
 * client retrying in a loop would otherwise keep every rejection and turn
 * each into `plan_limit_hit`. A repeat is marked so analytics skips it too.
 * Counter failures count as repeats: the rejection itself never depends on them.
 */
async function keepQuotaRejection(event: WideEvent): Promise<boolean> {
  if (event.status_code !== 429 || event.outcome !== "QuotaExceeded" || !event.user_id) {
    return false;
  }
  let kept = false;
  try {
    const key = `quota429:${event.user_id}`;
    kept = (await runtime.runPromise(hitRateLimit(key, 60_000, QUOTA_REJECTIONS_KEPT))).allowed;
  } catch {
    // Counted as a repeat.
  }
  if (!kept) event.flags = { ...event.flags, quota_repeat: true };
  return kept;
}

/**
 * Whether a finished request is routine for sampling. A 429 is, so a flood
 * of rejected requests can't flood the logs, unless the route keeps them;
 * anything that logged a notice never is (the same rule as job ticks). A
 * user's first few plan-quota rejections a minute are kept: they are the
 * upgrade signal (`plan_limit_hit`), not a flood.
 */
function isRoutine(
  spec: RequestEventSpec,
  request: Request,
  event: WideEvent,
  keptQuotaRejection: boolean,
): boolean {
  if ((event.notices?.length ?? 0) > 0) return false;
  if (keptQuotaRejection) return false;
  if (event.status_code === 429) return spec.keepRateLimited !== true;
  if (typeof spec.routine === "function") {
    try {
      return spec.routine(request);
    } catch {
      return false;
    }
  }
  return spec.routine === true;
}

/**
 * Middleware for route handlers: one wide event per request. It sets the
 * request id, route, method, status, duration and outcome, and writes the
 * event once in `finally`; the handler adds business context (ids, plan,
 * mode) to the `event` it is given and passes it to `runRoute`. The response
 * carries the id as `x-request-id`, so a user's report can be found in the logs.
 * Logging never changes the response: the logger swallows its own failures.
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
      if (!skipped.has(event)) {
        event.duration_ms = Date.now() - startedAt;
        const status = event.status_code ?? 500;
        event.outcome ??= status >= 500 ? "error" : status >= 400 ? "rejected" : "ok";
        const keptQuotaRejection = await keepQuotaRejection(event);
        logger.emit(event, { routine: isRoutine(spec, request, event, keptQuotaRejection) });
      }
    }
  };
}

/**
 * The caller's ids on the event. Requests made while impersonating carry the
 * admin's id, from the scope or the session, so a route passing either one
 * keeps the admin's work out of product analytics.
 */
export function annotateCaller(
  event: WideEvent,
  caller: {
    session?: { user: { id: string }; session: { impersonatedBy?: string | null } } | null;
    scope?: { userId: string; organizationId: string; impersonatedBy?: string } | null;
  },
): void {
  event.user_id = caller.scope?.userId ?? caller.session?.user.id ?? event.user_id;
  event.organization_id = caller.scope?.organizationId ?? event.organization_id;
  const impersonatedBy = caller.scope?.impersonatedBy ?? caller.session?.session.impersonatedBy;
  if (impersonatedBy) event.impersonated_by = impersonatedBy;
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
