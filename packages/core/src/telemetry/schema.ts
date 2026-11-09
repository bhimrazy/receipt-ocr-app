/**
 * The one wide-event schema, shared by every unit of work: an API request, a
 * page render, a job attempt and a queue tick each emit one JSON line built
 * from these fields (see `logger.ts`).
 *
 * The schema is also the redaction allowlist: `sanitize` keeps only the keys
 * listed here, and only values of the listed kind. Anything else is dropped
 * and its path recorded in `dropped_fields`, so a mistake shows up in the logs
 * without leaking what was dropped.
 *
 * High-cardinality ids are welcome. Content is not: no receipt text, merchant
 * names, amounts, file names, emails, tokens, error messages or URLs with a
 * query string. Errors are described by `error.type` / `error.class` /
 * `error.kind` / `error.code`, never by their message (provider and Drizzle
 * messages can embed receipt data and bound `params:`).
 *
 * Keys are snake_case and stable. For OTLP export they map onto log-record
 * attributes as they are; `service`, `version` and `env` map to the resource
 * attributes `service.name`, `service.version` and `deployment.environment.name`,
 * `level` to `SeverityText`, `timestamp` to `Timestamp` and `event` to `EventName`.
 */

/**
 * - `uuid`: a UUID (receipt, group, job and request ids).
 * - `id`: an opaque id (Better Auth user and workspace ids, worker id). No `@`, no spaces.
 * - `token`: a short code from our own vocabulary (outcome, kind, model id, plan).
 * - `route`: a route pattern or path; any query string or hash is cut off.
 * - `int` / `number` / `bool`: as named; non-finite numbers are dropped.
 * - `tokens`: a short list of tokens.
 * - `token_map`: a small map of token keys to token, number or boolean values.
 * - `number_map`: a small map of token keys to numbers (step timings, counts).
 * - `group`: a nested object with its own schema.
 * - `list`: a short list of objects with one schema.
 */
export type FieldKind =
  | "uuid"
  | "id"
  | "token"
  | "route"
  | "int"
  | "number"
  | "bool"
  | "tokens"
  | "token_map"
  | "number_map"
  | { readonly group: FieldSpec }
  | { readonly list: FieldSpec };

export type FieldSpec = { readonly [key: string]: FieldKind };

export const ERROR_FIELDS = {
  /** The typed error's tag (`DbError`, `OcrError`), or `Defect` for a bug. */
  type: "token",
  /** The class of the underlying error (`TypeError`, `PostgresError`). */
  class: "token",
  /** A short code: the OCR failure kind, the job error kind. */
  kind: "token",
  /** A driver code: a Postgres SQLSTATE (`23505`), or `query_timeout` / `connect_timeout` for the pg client's own timeouts. */
  code: "token",
  /** Next.js's error digest, which links a server log to the error page a user saw. */
  digest: "token",
  retryable: "bool",
} as const satisfies FieldSpec;

export const EVENT_SCHEMA = {
  /** What happened: `receipt.upload`, `page.render`, `job.attempt`, `job.tick`. */
  event: "token",
  /** The unit of work: `request`, `page`, `job_attempt`, `job_tick`, or `log` for a standalone notice. */
  unit: "token",
  /** Forces the level; otherwise `logger.emit` derives it from the outcome. */
  level: "token",
  outcome: "token",

  // Request
  request_id: "uuid",
  route: "route",
  method: "token",
  status_code: "int",
  duration_ms: "number",
  /** Next.js's route type for a failed render (`render`, `route`, `action`). */
  route_type: "token",
  /** How a page was opened, when we can tell: `pwa` for the installed app's start URL. */
  launch_source: "token",

  // Who and what
  user_id: "id",
  organization_id: "id",
  impersonated_by: "id",
  receipt_id: "uuid",
  /** A receipt group. Never its name or colour: names are user text. */
  group_id: "uuid",
  job_id: "uuid",
  /** Attempt of the job (1-based), out of `max_attempts`. */
  attempt: "int",
  max_attempts: "int",
  /** Round of the receipt: its upload or nth retry. */
  round: "int",
  worker: "id",
  /** What started the job run: `upload`, `retry`, `poll`, `drain`, `admin_rerun`. */
  trigger: "token",
  plan: "token",
  /** Upload mode: `instant` or `queued`. */
  mode: "token",
  /**
   * Upload size a reviewed photo was sent at: `compact` (labelled Compact, 600 px wide),
   * `smaller` (Small), `recommended` (Standard) or `larger` (Sharpest; also every long receipt).
   * Absent for PDFs.
   */
  size_choice: "token",
  /** How the browser encoded a reviewed photo; client-reported, checked against our own values. */
  encode: {
    group: {
      /** JPEG quality of the step that was sent (0.8, 0.72 or 0.65). */
      quality: "number",
      /** Encodes made, rescue included. */
      attempts: "int",
      /** Filter id: `original`, `enhance`, `grey` or `bw`. */
      filter: "token",
      /** Re-encoded at Compact's size because every step was over the hard cap. */
      rescued: "bool",
    },
  },
  /** A named action (admin action, auth endpoint). */
  action: "token",
  /** A short qualifier for events that need one (email kind, settings key). */
  kind: "token",
  count: "int",
  /** Feature flags and settings that shaped this unit of work. */
  flags: "token_map",

  file: {
    group: {
      size_bytes: "int",
      media_type: "token",
      /** Pixel size read from the uploaded bytes' header, before EXIF rotation. */
      width: "int",
      height: "int",
      /** `size_bytes` over `width` x `height`, to three decimals. */
      bytes_per_pixel: "number",
    },
  },

  /** OCR for this unit of work. Cost is summed over `job.attempt` events only. */
  ocr: {
    group: {
      /** The model that answered, or the last one tried. */
      model: "token",
      provider: "token",
      /** Model calls made (the chain falls back on failure). */
      calls: "int",
      /** A fallback model was called. */
      fallback: "bool",
      /** The extraction prompt version (`v2`), from `@receipt-ocr/ai`'s `PROMPT_VERSION`. Our constant, no PII. */
      prompt_version: "token",
      tokens_in: "int",
      tokens_out: "int",
      tokens_cached: "int",
      tokens_reasoning: "int",
      cost_micro_usd: "number",
      confidence: "number",
      items_count: "int",
      failure_kind: "token",
    },
  },
  /** Per-step durations: `storage.put`, `db.insert`, `storage.get`, `ai.extract`, `db.complete`. */
  timings_ms: "number_map",

  queue: {
    group: {
      kind: "token",
      priority: "int",
      /** From when the job became runnable (`run_at`) to its claim, by the database clock. */
      wait_ms: "number",
      /** `succeeded`, `retry`, `deferred`, `dead` or `lost`. */
      outcome: "token",
      error_kind: "token",
      next_run_in_ms: "number",
      /** Why a run had nothing to do: `not-found`, `superseded`. */
      skipped: "token",
    },
  },
  /** One queue tick: what it claimed and how those runs ended, and what the reaper took back. */
  tick: {
    group: {
      claimed: "int",
      succeeded: "int",
      retried: "int",
      deferred: "int",
      dead: "int",
      lost: "int",
      reaped: "int",
      reaped_dead: "int",
      idle: "bool",
    },
  },

  /** A billing webhook or its apply job. Provider ids and states only, never amounts or emails. */
  billing: {
    group: {
      provider: "token",
      /** The provider's event type, e.g. `subscription.updated`. */
      event_type: "token",
      /** The provider's event id (`evt_…`). */
      event_id: "id",
      subscription_id: "id",
      /** The subscription status the event carried. */
      status: "token",
      /** `recorded`, `duplicate`, `ignored`, `rejected`, or the apply outcome (`applied`, `stale`, `unmatched`). */
      outcome: "token",
      /** Why a webhook was refused: `missing-signature`, `bad-signature`, `stale-signature`, `bad-body`. */
      rejection: "token",
      /** Why a new subscription wasn't linked: `workspace`, `owner`, `price`, or `subscription` (an adjustment for one we don't have). */
      unmatched_reason: "token",
      /** A subscription whose workspace or buyer is gone can still charge, so the job cancels it. Set from the stored row's workspace and buyer links and the event's status; no personal data. */
      orphan_charging: "bool",
      /** An adjustment's action: `refund`, `chargeback`, `credit` and their reversals. */
      adjustment_action: "token",
      /** Set when an applied event moved its workspace between plans (`free`, `pro`): the `plan_changed` product event. */
      plan_from: "token",
      plan_to: "token",
      /**
       * The provider's error code on a failed call, from a closed set: Paddle's `error.code` when
       * it is in `PADDLE_ERROR_CODES` (e.g. `transaction_default_checkout_url_not_set`), else
       * `other`. Our own list, never free text from the provider; no personal data.
       */
      provider_error_code: "token",
    },
  },

  error: { group: ERROR_FIELDS },
  /** Names of problems logged while this unit ran (`receipt.calls_not_recorded`). */
  notices: "tokens",

  // Event-specific
  checks: "token_map",
  counts: "number_map",
  topic: "token",
  message_length: "int",
  delivered: "bool",
  /** Contact form: `queued`, `rate_limited` or `enqueue_failed`. */
  auto_reply: "token",
  turnstile_errors: "tokens",
  /** Newsletter routes: the step and its result (`confirm_sent`, `confirmed`, `expired`). No address. */
  newsletter: "token",
  /** CSP reports: the directive and the blocked host or keyword only. */
  violations: { list: { directive: "token", blocked: "token" } },
} as const satisfies FieldSpec;

type ValueOf<K> = K extends "uuid" | "id" | "token" | "route"
  ? string
  : K extends "int" | "number"
    ? number
    : K extends "bool"
      ? boolean
      : K extends "tokens"
        ? string[]
        : K extends "token_map"
          ? Record<string, string | number | boolean>
          : K extends "number_map"
            ? Record<string, number>
            : K extends { readonly group: infer S }
              ? Fields<S>
              : K extends { readonly list: infer S }
                ? Fields<S>[]
                : never;

type Fields<S> = { -readonly [P in keyof S]?: ValueOf<S[P]> | null };

/** One unit of work's event, built up while it runs and emitted once. */
export type WideEvent = Fields<typeof EVENT_SCHEMA> & { event: string };

/** Fields any code may add to the current event. */
export type WideEventFields = Fields<typeof EVENT_SCHEMA>;

export type ErrorFields = Fields<typeof ERROR_FIELDS>;
