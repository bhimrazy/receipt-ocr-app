import { isUuid } from "../ids";
import { isSecretShaped, REDACTED } from "./secrets";
import { EVENT_SCHEMA, type ErrorFields, type FieldKind, type FieldSpec } from "./schema";

const ID = /^[A-Za-z0-9_.:-]{1,128}$/;
/** Our own codes: no spaces or `@`, so free text and email addresses never fit. */
const TOKEN = /^[A-Za-z0-9_.:/[\]+-]{1,100}$/;
const ROUTE = /^\/[A-Za-z0-9_.:/[\]~-]{0,200}$/;
const MAX_ITEMS = 20;
const MAX_KEYS = 32;
/** Map keys that would touch the prototype of the output object. */
const UNSAFE_KEYS = new Set(["__proto__", "constructor", "prototype"]);

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" &&
  value !== null &&
  !Array.isArray(value) &&
  Object.getPrototypeOf(value) === Object.prototype;

const token = (value: unknown) =>
  typeof value === "string" && TOKEN.test(value) ? value : undefined;

/** A map key that is safe to name in `dropped_fields`: token-shaped and not a secret. */
const safeKey = (key: string) => (isSecretShaped(key) ? undefined : token(key));

const DROP = Symbol("drop");

type Sink = { dropped: string[]; redacted: number };

/**
 * Checked before any allowlist kind accepts a string, because `id` and `token`
 * are loose enough to fit API keys. Not applied to `uuid` (strict) or numbers.
 * A 64-hex digest such as a file's sha256 is treated as a secret on purpose:
 * no field logs one, and a new one should be a `uuid` or a deliberate kind.
 */
const redactSecret = (value: unknown, sink: Sink): typeof REDACTED | undefined => {
  if (typeof value !== "string" || !isSecretShaped(value)) return undefined;
  sink.redacted += 1;
  return REDACTED;
};

function clean(kind: FieldKind, value: unknown, path: string, sink: Sink): unknown {
  if (kind === "id" || kind === "token" || kind === "route") {
    const redacted = redactSecret(value, sink);
    if (redacted) return redacted;
  }
  switch (kind) {
    case "uuid":
      return typeof value === "string" && isUuid(value) ? value : DROP;
    case "id":
      return typeof value === "string" && ID.test(value) ? value : DROP;
    case "token":
      return token(value) ?? DROP;
    case "route": {
      if (typeof value !== "string") return DROP;
      const path = value.split(/[?#]/, 1)[0] ?? "";
      return ROUTE.test(path) ? path : DROP;
    }
    case "int":
      return typeof value === "number" && Number.isInteger(value) ? value : DROP;
    case "number":
      return typeof value === "number" && Number.isFinite(value) ? value : DROP;
    case "bool":
      return typeof value === "boolean" ? value : DROP;
    case "tokens": {
      if (!Array.isArray(value)) return DROP;
      const kept = value
        .slice(0, MAX_ITEMS)
        .flatMap((v) => redactSecret(v, sink) ?? token(v) ?? []);
      return kept.length > 0 ? kept : DROP;
    }
    case "token_map":
    case "number_map": {
      if (!isPlainObject(value)) return DROP;
      const out: Record<string, unknown> = {};
      for (const [key, v] of Object.entries(value).slice(0, MAX_KEYS)) {
        const keyOk = safeKey(key) !== undefined && !UNSAFE_KEYS.has(key);
        const secret = kind === "token_map" && keyOk ? redactSecret(v, sink) : undefined;
        const ok =
          keyOk &&
          !secret &&
          (kind === "number_map"
            ? typeof v === "number" && Number.isFinite(v)
            : (typeof v === "number" && Number.isFinite(v)) ||
              typeof v === "boolean" ||
              token(v) !== undefined);
        if (ok) out[key] = v;
        else if (secret) out[key] = secret;
        else sink.dropped.push(`${path}.${safeKey(key) ?? "?"}`);
      }
      return Object.keys(out).length > 0 ? out : DROP;
    }
    default:
      if ("group" in kind) {
        if (!isPlainObject(value)) return DROP;
        const out = sanitizeWith(kind.group, value, `${path}.`, sink);
        return Object.keys(out).length > 0 ? out : DROP;
      }
      if (!Array.isArray(value)) return DROP;
      return value
        .slice(0, MAX_ITEMS)
        .flatMap((item) =>
          isPlainObject(item) ? [sanitizeWith(kind.list, item, `${path}[].`, sink)] : [],
        );
  }
}

function sanitizeWith(
  spec: FieldSpec,
  input: Record<string, unknown>,
  prefix: string,
  sink: Sink,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined || value === null) continue;
    // Own keys only: `constructor`, `toString` and `__proto__` are not schema fields.
    const kind = Object.hasOwn(spec, key) ? spec[key] : undefined;
    // The key itself is code, but keep it out if it doesn't look like one.
    const path = `${prefix}${safeKey(key) ?? "?"}`;
    if (!kind) {
      sink.dropped.push(path);
      continue;
    }
    const kept = clean(kind, value, path, sink);
    if (kept === DROP) sink.dropped.push(path);
    else out[key] = kept;
  }
  return out;
}

/**
 * Applies the schema allowlist: keeps known keys whose values have the
 * schema's kind, drops everything else and reports the dropped paths (never
 * their values). Null and undefined are treated as absent. A string value
 * shaped like a secret is replaced by `[redacted:secret]` and counted.
 */
export function sanitize(event: Record<string, unknown>): {
  fields: Record<string, unknown>;
  dropped: string[];
  redacted: number;
} {
  const sink: Sink = { dropped: [], redacted: 0 };
  const fields = sanitizeWith(EVENT_SCHEMA, event, "", sink);
  return { fields, dropped: sink.dropped.slice(0, MAX_ITEMS), redacted: sink.redacted };
}

/** A Postgres SQLSTATE, from the driver error or the error it wraps. */
function sqlState(error: unknown, depth = 0): string | undefined {
  if (!error || typeof error !== "object" || depth > 3) return undefined;
  const code = (error as { code?: unknown }).code;
  if (typeof code === "string" && /^[0-9A-Z]{5}$/.test(code)) return code;
  return sqlState((error as { cause?: unknown }).cause, depth + 1);
}

const className = (error: unknown) =>
  error instanceof Error
    ? token(error.constructor.name !== "Error" ? error.constructor.name : error.name)
    : typeof error;

/**
 * Describes an error for a wide event without its message: the typed error's
 * tag and short kind, the underlying class and a driver code. Messages are
 * left out because provider and Drizzle errors embed receipt data and bound
 * `params:`.
 */
export function errorFields(error: unknown): ErrorFields {
  try {
    if (error && typeof error === "object" && "_tag" in error && typeof error._tag === "string") {
      const tagged = error as { _tag: string; kind?: unknown; cause?: unknown };
      return {
        type: token(tagged._tag),
        kind: token(tagged.kind),
        class: tagged.cause === undefined ? undefined : className(tagged.cause),
        code: sqlState(tagged.cause),
      };
    }
    return { class: className(error), code: sqlState(error) };
  } catch {
    // A hostile or broken error (a throwing getter, a revoked proxy) still gets logged as one.
    return { type: "Unreadable" };
  }
}
