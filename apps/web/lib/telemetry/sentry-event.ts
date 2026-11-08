import type { Breadcrumb, ErrorEvent, StackFrame } from "@sentry/browser";
import { isContentError, scrubMessage, scrubUrl } from "./scrub";

/**
 * `beforeSend` for both runtimes: the event is rebuilt from an allowlist, the
 * way wide events are, instead of deleting what we know to be risky. Kept:
 * error types, scrubbed messages, stack frames (file, function, line), our
 * own tags, release, environment, the runtime and browser names, and the
 * request's method and scrubbed URL. Dropped: user, headers, cookies, bodies,
 * query strings, extra data, frame variables and source lines, server name,
 * and every breadcrumb but navigation and fetch/xhr (URLs scrubbed).
 */

const TAG_KEYS = new Set([
  "route",
  "route_type",
  "method",
  "request_id",
  "digest",
  "error_type",
  "error_kind",
  "error_code",
  "event",
  "status_code",
  "runtime",
]);
const TAG_VALUE = /^[\w.:/[\]-]{1,120}$/;

const tags = (input: ErrorEvent["tags"]) => {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(input ?? {})) {
    const text = typeof value === "number" || typeof value === "boolean" ? String(value) : value;
    if (TAG_KEYS.has(key) && typeof text === "string" && TAG_VALUE.test(text)) out[key] = text;
  }
  return out;
};

const frame = (f: StackFrame): StackFrame => ({
  ...(f.filename ? { filename: scrubUrl(f.filename) } : {}),
  ...(f.abs_path ? { abs_path: scrubUrl(f.abs_path) } : {}),
  ...(f.module ? { module: f.module } : {}),
  ...(f.function ? { function: f.function } : {}),
  ...(f.lineno !== undefined ? { lineno: f.lineno } : {}),
  ...(f.colno !== undefined ? { colno: f.colno } : {}),
  ...(f.in_app !== undefined ? { in_app: f.in_app } : {}),
});

const breadcrumb = (b: Breadcrumb): Breadcrumb | null => {
  const data = b.data ?? {};
  const url = (value: unknown) => (typeof value === "string" ? scrubUrl(value) : undefined);
  if (b.category === "navigation") {
    return {
      category: b.category,
      timestamp: b.timestamp,
      data: { from: url(data.from), to: url(data.to) },
    };
  }
  if (b.category === "fetch" || b.category === "xhr") {
    return {
      category: b.category,
      timestamp: b.timestamp,
      level: b.level,
      data: {
        url: url(data.url),
        method: typeof data.method === "string" ? data.method : undefined,
        status_code: typeof data.status_code === "number" ? data.status_code : undefined,
      },
    };
  }
  return null;
};

const named = (context: Record<string, unknown> | undefined) =>
  context && typeof context.name === "string"
    ? {
        name: context.name,
        ...(typeof context.version === "string" ? { version: context.version } : {}),
      }
    : undefined;

export function scrubEvent(event: ErrorEvent): ErrorEvent {
  const values = event.exception?.values ?? [];
  const out: ErrorEvent = {
    type: undefined,
    event_id: event.event_id,
    timestamp: event.timestamp,
    level: event.level,
    platform: event.platform,
    release: event.release,
    environment: event.environment,
    sdk: event.sdk,
    tags: tags(event.tags),
  };
  if (event.fingerprint) out.fingerprint = event.fingerprint;
  if (event.message) out.message = scrubMessage(event.message);
  if (values.length > 0) {
    out.exception = {
      values: values.map((value) => ({
        type: value.type,
        // AI SDK errors carry the receipt or the request body in their message (security plan B1).
        value: isContentError(value.type)
          ? "[redacted]"
          : value.value
            ? scrubMessage(value.value)
            : value.value,
        ...(value.mechanism
          ? { mechanism: { type: value.mechanism.type, handled: value.mechanism.handled } }
          : {}),
        ...(value.stacktrace?.frames
          ? { stacktrace: { frames: value.stacktrace.frames.map(frame) } }
          : {}),
      })),
    };
  }
  const contexts = {
    runtime: named(event.contexts?.runtime),
    browser: named(event.contexts?.browser),
    os: named(event.contexts?.os),
  };
  out.contexts = Object.fromEntries(Object.entries(contexts).filter(([, v]) => v !== undefined));
  if (event.request?.url) {
    out.request = {
      url: scrubUrl(event.request.url),
      ...(event.request.method ? { method: event.request.method } : {}),
    };
  }
  const crumbs = (event.breadcrumbs ?? []).map(breadcrumb).filter((b) => b !== null);
  if (crumbs.length > 0) out.breadcrumbs = crumbs;
  return out;
}

/** For `beforeBreadcrumb`: the same rule, applied as breadcrumbs are recorded. */
export const scrubBreadcrumb = breadcrumb;
