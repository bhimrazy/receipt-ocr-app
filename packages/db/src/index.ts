import { relations, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import {
  bigint,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import pg from "pg";
import {
  account,
  invitation,
  member,
  organization,
  passkey,
  rateLimit,
  session,
  twoFactor,
  user,
  verification,
} from "./auth-schema";

export * from "./auth-schema";
// Re-export query operators so consumers use THIS package's drizzle-orm
// instance (avoids duplicate-instance type conflicts with isolated installs).
export {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  gte,
  ilike,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  ne,
  or,
  sql,
  type SQL,
} from "drizzle-orm";

export const receiptStatus = pgEnum("receipt_status", [
  "uploaded",
  "processing",
  "completed",
  "failed",
]);

/** Upload plus retries; `receipts_attempts_check` enforces it. */
export const MAX_EXTRACTION_ATTEMPTS = 3;

export const receipts = pgTable(
  "receipts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** The workspace that owns this receipt. Every member of it can read it. */
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    /**
     * Who uploaded it. Kept for attribution — it does NOT scope visibility.
     * Null once that user is deleted: the receipt stays with its workspace.
     */
    userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
    merchant: text("merchant"),
    /**
     * The transaction day in AD, a plain calendar date (no time zone), read as
     * `YYYY-MM-DD`. Null when none was read or it failed the plausibility check.
     */
    receiptDate: date("receipt_date", { mode: "string" }),
    category: text("category"),
    /** ISO 4217, upper case. Null = not read; readers show it as USD. */
    currency: text("currency").default("USD"),
    subtotal: numeric("subtotal", { precision: 12, scale: 2 }),
    tax: numeric("tax", { precision: 12, scale: 2 }),
    tip: numeric("tip", { precision: 12, scale: 2 }),
    total: numeric("total", { precision: 12, scale: 2 }),
    confidence: numeric("confidence", { precision: 5, scale: 4 }),
    status: receiptStatus("status").notNull().default("uploaded"),
    /** Original upload name; kept outside raw_json, which extraction overwrites. */
    fileName: text("file_name"),
    imageObjectKey: text("image_object_key"),
    // Which storage credentials the image was written with: "managed" | "byok".
    storageSource: text("storage_source").notNull().default("managed"),
    rawJson: jsonb("raw_json"),
    errorMessage: text("error_message"),
    /** Extraction attempts so far (1 = the upload itself); retries are capped on this. */
    attempts: integer("attempts").notNull().default(1),
    /** When the latest retry started. Written, not read: quota counts the ledger. */
    lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }),
    /** `provider:model` that produced the extraction; null until one has. */
    model: text("model"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // A user's uploads, and the set-null on account delete.
    index("receipts_user_created_at_idx").on(table.userId, table.createdAt),
    // Admin upload charts and counts across workspaces.
    index("receipts_created_at_idx").on(table.createdAt),
    // History lists a workspace newest-first; this index serves that directly.
    index("receipts_org_created_at_idx").on(table.organizationId, table.createdAt),
    // History's date filters and date ranges within a workspace.
    index("receipts_org_receipt_date_idx").on(table.organizationId, table.receiptDate),
    // Not before 2000, and at most a day after the UTC upload day (time zones):
    // a misread or Bikram Sambat year stored as AD fails this. The dashboard's
    // created_at scan bound relies on the upper limit.
    check(
      "receipts_receipt_date_check",
      sql`receipt_date >= '2000-01-01' and receipt_date <= (created_at at time zone 'UTC')::date + 1`,
    ),
    check("receipts_currency_check", sql`currency ~ '^[A-Z]{3}$'`),
    check("receipts_attempts_check", sql.raw(`attempts between 1 and ${MAX_EXTRACTION_ATTEMPTS}`)),
  ],
).enableRLS();

export const receiptItems = pgTable(
  "receipt_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    receiptId: uuid("receipt_id")
      .notNull()
      .references(() => receipts.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** Whole units, at least 1 (core rounds a weight or a 0 up to 1). */
    quantity: integer("quantity").notNull().default(1),
    unitPrice: numeric("unit_price", { precision: 12, scale: 2 }),
    totalPrice: numeric("total_price", { precision: 12, scale: 2 }),
    confidence: numeric("confidence", { precision: 5, scale: 4 }),
  },
  (table) => [
    // Loading a receipt's items and the cascade delete both look up by receipt.
    index("receipt_items_receipt_id_idx").on(table.receiptId),
    check("receipt_items_quantity_check", sql`quantity >= 1`),
  ],
).enableRLS();

/**
 * Append-only usage ledger, two tables. `ocr_rounds` gets a row when an
 * upload or retry is accepted, before any model call, under the quota check;
 * `ocr_calls` gets a row per model call when the round ends. Quota, the global
 * cap and cost count from these, never from `receipts`, so deleting a receipt
 * or a workspace changes none of them. Deleting a workspace or account
 * unlinks the rows (set null) instead of removing them. No free text: nothing
 * here can hold receipt contents or provider messages.
 */
export const ocrRounds = pgTable(
  "ocr_rounds",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // No FK: the ledger outlives the receipt.
    receiptId: uuid("receipt_id").notNull(),
    organizationId: text("organization_id").references(() => organization.id, {
      onDelete: "set null",
    }),
    userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
    /** `receipts.attempts` it started: 1 = the upload, 2+ = retries. */
    round: smallint("round").notNull(),
    /**
     * The workspace's plan when the round was accepted, i.e. the allowance it
     * draws from: Free rounds count against their user, Pro rounds against their
     * workspace, so neither uses up the other.
     */
    plan: text("plan").notNull().default("free"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("ocr_rounds_receipt_round_idx").on(table.receiptId, table.round),
    // Per-user quota windows.
    index("ocr_rounds_user_created_at_idx").on(table.userId, table.createdAt),
    // Global cap and the per-plan daily pool.
    index("ocr_rounds_created_at_idx").on(table.createdAt),
    // Workspace-pooled (Pro) day and month windows, and the set-null when a workspace is deleted.
    index("ocr_rounds_org_created_at_idx").on(table.organizationId, table.createdAt),
    check("ocr_rounds_plan_check", sql`plan in ('free', 'pro')`),
  ],
).enableRLS();

/**
 * Allowed `ocr_calls.status` values: "ok", the AI failure kinds (kept in step
 * with `OCR_FAILURE_KINDS` in packages/ai by a core test), and
 * "storage-error" for a round that failed before any model was called.
 */
export const OCR_CALL_STATUSES = [
  "ok",
  "timeout",
  "rate-limited",
  "provider-error",
  "invalid-output",
  "bad-image",
  "not-configured",
  "refused",
  "unsupported-file",
  "storage-error",
] as const;

/**
 * One row per model call, success or failure, written when its round ends. A
 * round that failed before calling any model gets one row with a null model,
 * so it stops reading as in flight.
 */
export const ocrCalls = pgTable(
  "ocr_calls",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // No FK: deleting a receipt must not erase what its calls cost.
    receiptId: uuid("receipt_id").notNull(),
    organizationId: text("organization_id").references(() => organization.id, {
      onDelete: "set null",
    }),
    userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
    /** `receipts.attempts` at the time: 1 = the upload, 2+ = retries. */
    round: smallint("round").notNull(),
    /** Which automatic attempt of the round's job made the call (1 = first). */
    jobAttempt: smallint("job_attempt").notNull().default(1),
    /** Position in the chain: 0 = primary, >0 = a fallback. */
    step: smallint("step").notNull(),
    /** `provider:model`; null when the round failed before calling a model. */
    model: text("model"),
    provider: text("provider"),
    /** One of `OCR_CALL_STATUSES`. */
    status: text("status").notNull(),
    latencyMs: integer("latency_ms").notNull(),
    // Null = the provider didn't report it (timeout, API error), not zero.
    inputTokens: integer("input_tokens"),
    cachedInputTokens: integer("cached_input_tokens"),
    cacheWriteTokens: integer("cache_write_tokens"),
    /** Includes reasoning tokens. */
    outputTokens: integer("output_tokens"),
    reasoningTokens: integer("reasoning_tokens"),
    /** Priced when written, never recomputed; null = unknown. Sum as bigint. */
    costMicroUsd: integer("cost_micro_usd"),
    /** `from` of the price row used. */
    priceFrom: text("price_from"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Workspace usage.
    index("ocr_calls_org_created_at_idx").on(table.organizationId, table.createdAt),
    // Admin windows.
    index("ocr_calls_created_at_idx").on(table.createdAt),
    // The set-null when an account is deleted.
    index("ocr_calls_user_id_idx").on(table.userId),
    // A receipt's calls and the quota's "was this round read" lookup. Unique, so
    // an attempt's calls written twice (e.g. a lost COMMIT ack, then the
    // failure path) are billed once, while each automatic retry keeps its own.
    uniqueIndex("ocr_calls_receipt_round_attempt_step_idx").on(
      table.receiptId,
      table.round,
      table.jobAttempt,
      table.step,
    ),
    check(
      "ocr_calls_status_check",
      sql.raw(`status in (${OCR_CALL_STATUSES.map((s) => `'${s}'`).join(", ")})`),
    ),
  ],
).enableRLS();

/**
 * Background job states. `queued` includes "waiting to retry" (`run_at` in
 * the future); a failed attempt goes back to `queued` or on to `dead`.
 */
export const jobState = pgEnum("job_state", [
  "queued",
  "running",
  "succeeded",
  "dead",
  "cancelled",
]);

/** Job states that still hold their idempotency key and their receipt. */
const LIVE_JOB = sql`state in ('queued', 'running')`;

/**
 * The durable job queue (`packages/core/src/jobs`). Claimed with
 * `FOR UPDATE SKIP LOCKED` under a lease; every write after the claim is
 * fenced on `locked_by` and `state = 'running'`, so a worker whose lease
 * expired changes nothing. No free text: `last_error_kind` is a short code and
 * payloads hold ids only, never receipt contents. Storage parameters
 * (fillfactor, autovacuum) are set by hand at the end of the baseline migration;
 * drizzle-kit can't express them.
 */
export const jobs = pgTable(
  "jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: text("kind").notNull(),
    state: jobState("state").notNull().default("queued"),
    /** Lower runs first: 0 interactive, 5 bulk, 9 maintenance. */
    priority: smallint("priority").notNull().default(0),
    payload: jsonb("payload").notNull(),
    idempotencyKey: text("idempotency_key"),
    // No FK: the job record outlives a deleted receipt or workspace.
    receiptId: uuid("receipt_id"),
    organizationId: text("organization_id"),
    /** The owner, for the per-user running cap. Unlinked when the account is deleted. */
    userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
    /** Incremented at claim, so a job that crashes its worker still runs out of attempts. */
    attempts: smallint("attempts").notNull().default(0),
    maxAttempts: smallint("max_attempts").notNull(),
    runAt: timestamp("run_at", { withTimezone: true }).notNull().defaultNow(),
    /** Worker id holding the lease. */
    lockedBy: text("locked_by"),
    /** Lease end; deliberately unindexed so heartbeats stay HOT updates. */
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
    lastErrorKind: text("last_error_kind"),
    lastErrorAt: timestamp("last_error_at", { withTimezone: true }),
    /** The last five attempts: `{n, at, ms, outcome, kind?, worker}`. */
    attemptLog: jsonb("attempt_log")
      .notNull()
      .default(sql`'[]'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // The claim: only runnable rows, in claim order.
    index("jobs_runnable_idx")
      .on(table.priority, table.runAt)
      .where(sql`state = 'queued'`),
    // The reaper and per-owner running counts: a small set.
    index("jobs_running_idx")
      .on(table.userId)
      .where(sql`state = 'running'`),
    // The set-null when an account is deleted (finished jobs included).
    index("jobs_user_id_idx").on(table.userId),
    // One live job per key; a finished job frees its key.
    uniqueIndex("jobs_idempotency_idx").on(table.idempotencyKey).where(LIVE_JOB),
    // At most one live job per receipt.
    uniqueIndex("jobs_receipt_live_idx")
      .on(table.receiptId)
      .where(sql`state in ('queued', 'running') and kind like 'receipt.%'`),
    // Admin lists and retention.
    index("jobs_state_finished_idx").on(table.state, table.finishedAt),
    index("jobs_org_created_idx").on(table.organizationId, table.createdAt),
    // The admin jobs list, newest first.
    index("jobs_created_at_idx").on(table.createdAt),
    check("jobs_attempts_check", sql`attempts >= 0 and max_attempts >= 1`),
    // A code such as `rate-limited` or `lease-expired`, never a message.
    check("jobs_last_error_kind_check", sql`last_error_kind ~ '^[a-z0-9.-]{1,40}$'`),
  ],
).enableRLS();

/**
 * Pauses and cooldowns, one row per scope: `queue`, `kind:<kind>` or
 * `provider:<id>`. A row applies while `until` is null (indefinite) or ahead.
 */
export const jobControls = pgTable("job_controls", {
  scope: text("scope").primaryKey(),
  paused: boolean("paused").notNull().default(false),
  until: timestamp("until", { withTimezone: true }),
  reason: text("reason"),
  updatedBy: text("updated_by"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}).enableRLS();

/**
 * Reserved for user-provided BYOK credentials. Nothing reads or writes this
 * table yet, and no encryption for `ciphertext` exists: implement it (see
 * docs/byok-key-management.md) before storing any secret here.
 */
export const userCredentials = pgTable(
  "user_credentials",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(), // "gemini" | "s3"
    label: text("label"),
    last4: text("last4").notNull(),
    ciphertext: text("ciphertext").notNull(), // base64(nonce ‖ ct ‖ tag)
    status: text("status").notNull().default("active"), // active | invalid | revoked
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => [index("user_credentials_user_id_idx").on(table.userId)],
).enableRLS();

/**
 * One row per admin action: who did what to which target, and why. Actor and
 * target are snapshots (email, label) so entries still read after a deletion.
 */
export const adminAuditLog = pgTable(
  "admin_audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    actorId: text("actor_id").references(() => user.id, { onDelete: "set null" }),
    actorEmail: text("actor_email").notNull(),
    /** Dotted verb, e.g. `user.ban`, `workspace.delete`, `settings.plans`. */
    action: text("action").notNull(),
    targetType: text("target_type").notNull(), // user | workspace | settings | job
    targetId: text("target_id"),
    targetLabel: text("target_label"),
    reason: text("reason"),
    metadata: jsonb("metadata"),
    ip: text("ip"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("admin_audit_log_created_at_idx").on(table.createdAt),
    index("admin_audit_log_target_idx").on(table.targetType, table.targetId, table.createdAt),
    // The set-null when an admin's account is deleted.
    index("admin_audit_log_actor_id_idx").on(table.actorId),
  ],
).enableRLS();

/** Runtime settings an admin can change (`plans`, `ocr`). Values are validated on read and write. */
export const appSettings = pgTable("app_settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  updatedBy: text("updated_by").references(() => user.id, { onDelete: "set null" }),
}).enableRLS();

/**
 * A named collection of receipts in a workspace ("Berlin trip", "Taxes 2026").
 * Names are unique per workspace ignoring case; `color` is a palette key
 * validated in core.
 */
export const receiptGroups = pgTable(
  "receipt_groups",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    color: text("color").notNull(),
    /** Who may rename or delete it besides owners and admins. Null once that user is deleted. */
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("receipt_groups_org_name_idx").on(table.organizationId, sql`lower(${table.name})`),
  ],
).enableRLS();

/**
 * Receipts in a group (many-to-many). Nothing here checks that the receipt and
 * the group share a workspace; core only inserts rows selected through both
 * tables' `organization_id`.
 */
export const receiptGroupMembers = pgTable(
  "receipt_group_members",
  {
    groupId: uuid("group_id")
      .notNull()
      .references(() => receiptGroups.id, { onDelete: "cascade" }),
    receiptId: uuid("receipt_id")
      .notNull()
      .references(() => receipts.id, { onDelete: "cascade" }),
    addedBy: text("added_by").references(() => user.id, { onDelete: "set null" }),
    addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.groupId, table.receiptId] }),
    // Groups of a receipt, the History filter, and the cascade on receipt delete.
    index("receipt_group_members_receipt_id_idx").on(table.receiptId),
  ],
).enableRLS();

/** Provider subscription states we store; anything else is refused when parsed. */
export const BILLING_STATUSES = ["active", "trialing", "past_due", "paused", "canceled"] as const;

/**
 * One row per provider subscription, written only by the `billing.apply_event`
 * job from verified webhooks. A workspace is Pro while it has an entitling row
 * (see `packages/core/src/billing`). `provider_updated_at` orders events: an
 * older snapshot never overwrites a newer one. Ids and states only, no card or
 * address data.
 */
export const billingSubscriptions = pgTable(
  "billing_subscriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Null once the workspace is deleted; the row stays as the billing record. */
    organizationId: text("organization_id").references(() => organization.id, {
      onDelete: "set null",
    }),
    /** Who started the checkout. */
    userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
    provider: text("provider").notNull(),
    providerSubscriptionId: text("provider_subscription_id").notNull(),
    providerCustomerId: text("provider_customer_id").notNull(),
    /** One of `BILLING_STATUSES`. */
    status: text("status").notNull(),
    priceId: text("price_id"),
    /** `month` or `year`. */
    billingInterval: text("billing_interval"),
    currentPeriodStart: timestamp("current_period_start", { withTimezone: true }),
    currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
    /** A cancellation is scheduled for the period end; Pro holds until then. */
    cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
    /** When it last became past_due; the grace period counts from here. */
    pastDueSince: timestamp("past_due_since", { withTimezone: true }),
    canceledAt: timestamp("canceled_at", { withTimezone: true }),
    /** A chargeback or full refund ended Pro at this time; the provider cancel follows. */
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    /** The provider's own `updated_at` for the snapshot stored here. */
    providerUpdatedAt: timestamp("provider_updated_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("billing_subscriptions_provider_id_idx").on(
      table.provider,
      table.providerSubscriptionId,
    ),
    index("billing_subscriptions_org_idx").on(table.organizationId),
    check(
      "billing_subscriptions_status_check",
      sql.raw(`status in (${BILLING_STATUSES.map((s) => `'${s}'`).join(", ")})`),
    ),
    check(
      "billing_subscriptions_interval_check",
      sql`billing_interval is null or billing_interval in ('month', 'year')`,
    ),
  ],
).enableRLS();

/**
 * Every verified webhook, once: the unique provider event id makes a redelivery
 * a no-op. `payload` is the provider-neutral snapshot the job applies (ids,
 * states, dates), never the raw body, so it holds no address or card data.
 */
export const billingEvents = pgTable(
  "billing_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    provider: text("provider").notNull(),
    providerEventId: text("provider_event_id").notNull(),
    eventType: text("event_type").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    // No FK: the event log outlives a deleted workspace.
    organizationId: text("organization_id"),
    payload: jsonb("payload").notNull(),
    /** `applied`, `stale` (older than the stored snapshot), `ignored` or `unmatched` (no workspace). */
    outcome: text("outcome"),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("billing_events_provider_event_idx").on(table.provider, table.providerEventId),
    index("billing_events_org_idx").on(table.organizationId, table.receivedAt),
    check(
      "billing_events_outcome_check",
      sql`outcome is null or outcome in ('applied', 'stale', 'ignored', 'unmatched')`,
    ),
  ],
).enableRLS();

export const receiptsRelations = relations(receipts, ({ many }) => ({
  items: many(receiptItems),
}));

export const receiptItemsRelations = relations(receiptItems, ({ one }) => ({
  receipt: one(receipts, {
    fields: [receiptItems.receiptId],
    references: [receipts.id],
  }),
}));

/**
 * One row per "verify it's you" event: a code sent, a check passed or failed.
 * Kept as the step-up audit trail (also when the session is gone), and read for
 * the failure lockout and TOTP replay protection.
 */
export const stepUpEvents = pgTable(
  "step_up_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    sessionId: text("session_id").references(() => session.id, { onDelete: "set null" }),
    /** What asked for the check, e.g. `account.delete`, `admin.user.ban`. */
    action: text("action").notNull(),
    method: text("method").notNull(), // totp | backup_code | passkey | email
    outcome: text("outcome").notNull(), // sent | verified | failed
    /** The TOTP time step a verified code matched, so it can't be used twice. */
    totpCounter: bigint("totp_counter", { mode: "number" }),
    ip: text("ip"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("step_up_events_user_created_idx").on(table.userId, table.createdAt),
    check(
      "step_up_events_method_check",
      sql`method in ('totp', 'backup_code', 'passkey', 'email')`,
    ),
    check("step_up_events_outcome_check", sql`outcome in ('sent', 'verified', 'failed')`),
  ],
).enableRLS();

/**
 * Emailed step-up codes for users without a second factor. Bound to one
 * session; only an HMAC of the code is stored.
 */
export const stepUpCodes = pgTable(
  "step_up_codes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sessionId: text("session_id")
      .notNull()
      .references(() => session.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    codeHash: text("code_hash").notNull(),
    attempts: smallint("attempts").notNull().default(0),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("step_up_codes_session_idx").on(table.sessionId),
    index("step_up_codes_user_created_idx").on(table.userId, table.createdAt),
  ],
).enableRLS();

export const schema = {
  receiptStatus,
  receipts,
  receiptItems,
  ocrRounds,
  ocrCalls,
  jobState,
  jobs,
  jobControls,
  userCredentials,
  adminAuditLog,
  appSettings,
  receiptGroups,
  receiptGroupMembers,
  stepUpEvents,
  stepUpCodes,
  billingSubscriptions,
  billingEvents,
  receiptsRelations,
  receiptItemsRelations,
  // Better Auth tables (core + organization + admin plugins).
  user,
  session,
  account,
  verification,
  organization,
  member,
  invitation,
  rateLimit,
  twoFactor,
  passkey,
};

const POOLS_KEY = Symbol.for("@receipt-ocr/db/pools");

/**
 * One pool per connection string, per process, shared by auth, admin and the Effect runtime. A
 * pool per caller would exhaust a pooler's client limit. On `globalThis` because Next can load
 * this module more than once per process (instrumentation, route bundles).
 */
const pools: Map<string, ReturnType<typeof drizzle<typeof schema>>> = ((
  globalThis as { [POOLS_KEY]?: Map<string, ReturnType<typeof drizzle<typeof schema>>> }
)[POOLS_KEY] ??= new Map());

const envInt = (name: string, fallback: number) =>
  Number.parseInt(process.env[name] ?? "", 10) || fallback;

/**
 * Max connections per process. Behind a pooler each is one of its client connections (Supavisor
 * on Nano/Micro: 200), so instances x this must stay under that limit.
 */
const MAX_CONNECTIONS = envInt("DATABASE_POOL_MAX", 10);

/**
 * How long a query may go unanswered before it fails (pg's `query_timeout`). It catches what the
 * server can't: a dead socket or a reply lost on the way. A valid statement that runs longer,
 * typically one waiting on a lock, fails too, and a timed-out write may still commit. Keep the
 * server's `statement_timeout` below this so the server ends long statements first.
 */
const QUERY_TIMEOUT_MS = envInt("DATABASE_QUERY_TIMEOUT_MS", 15_000);

const isQueryTimeout = (error: unknown) =>
  error instanceof Error && error.message === "Query read timeout";

/**
 * Closes the connection when a query on it times out. `pool.query` already drops such a client,
 * but drizzle's `transaction()` releases its client without the error, which would put a
 * connection with an unfinished statement (and maybe an open transaction) back in the pool.
 * Statements sent after that (drizzle's ROLLBACK) fail with the timeout itself, not "Client was
 * closed", so the caller sees why.
 */
class TimeoutClosingClient extends pg.Client {
  private timedOut: Error | undefined;

  constructor(...args: ConstructorParameters<typeof pg.Client>) {
    super(...args);
    // pg-pool removes its own listener while a client is checked out and drizzle's transaction()
    // adds none, so a session the server ends mid-transaction (idle_in_transaction_session_timeout,
    // a restart) would otherwise be an uncaught exception. The next query on it fails instead.
    this.on("error", () => {});
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- one override for all of pg's overloads
  override query(...args: unknown[]): any {
    const callback = args.at(-1);
    if (this.timedOut) {
      if (typeof callback !== "function") return Promise.reject(this.timedOut);
      process.nextTick(callback as (error: Error) => void, this.timedOut);
      return undefined;
    }
    const result = (super.query as (...a: unknown[]) => unknown)(...args);
    if (typeof callback !== "function" && result instanceof Promise) {
      result.catch((error: unknown) => {
        if (!isQueryTimeout(error)) return;
        this.timedOut = error as Error;
        void this.end();
      });
    }
    return result;
  }
}

/**
 * With `DATABASE_SSL_CA` (PEM) set, the connection is TLS verified against that CA, for a server
 * whose certificate no public CA signs (Supabase, RDS). The URL's `sslmode` is dropped then: pg lets
 * it override `ssl`, and treats `require` as verify-full against Node's public CAs.
 */
export function tlsOptions(connectionString: string, ca = process.env.DATABASE_SSL_CA) {
  const pem = ca?.trim().replaceAll("\\n", "\n");
  if (!pem) return { connectionString };
  const url = new URL(connectionString);
  url.searchParams.delete("sslmode");
  return { connectionString: url.toString(), ssl: { ca: pem, rejectUnauthorized: true } };
}

/** A pg pool with this app's limits and timeouts; `createDb` is the one caller outside tests. */
export function createPool(
  connectionString: string,
  { max = MAX_CONNECTIONS, queryTimeoutMs = QUERY_TIMEOUT_MS } = {},
) {
  const pool = new pg.Pool({
    Client: TimeoutClosingClient,
    ...tlsOptions(connectionString),
    max,
    idleTimeoutMillis: 20_000,
    // Also bounds the wait for a free client when all `max` are busy.
    connectionTimeoutMillis: 10_000,
    query_timeout: queryTimeoutMs,
    keepAlive: true,
    allowExitOnIdle: true,
  });
  // An idle client whose server went away emits here; the pool has already dropped it.
  pool.on("error", () => {});
  return pool;
}

export function createDb(databaseUrl: string) {
  const cached = pools.get(databaseUrl);
  if (cached) return cached;
  const db = drizzle(createPool(databaseUrl), { schema });
  pools.set(databaseUrl, db);
  return db;
}

export type DbClient = ReturnType<typeof createDb>;
export type Receipt = typeof receipts.$inferSelect;
export type NewReceipt = typeof receipts.$inferInsert;
export type ReceiptItem = typeof receiptItems.$inferSelect;
export type NewReceiptItem = typeof receiptItems.$inferInsert;
export type OcrRound = typeof ocrRounds.$inferSelect;
export type OcrCall = typeof ocrCalls.$inferSelect;
export type NewOcrCall = typeof ocrCalls.$inferInsert;
export type JobRow = typeof jobs.$inferSelect;
export type NewJobRow = typeof jobs.$inferInsert;
export type AdminAuditEntry = typeof adminAuditLog.$inferSelect;
export type BillingSubscription = typeof billingSubscriptions.$inferSelect;
export type UserCredential = typeof userCredentials.$inferSelect;
export type NewUserCredential = typeof userCredentials.$inferInsert;
