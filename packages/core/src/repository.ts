import { normalizeCategory, type ReceiptExtraction } from "@receipt-ocr/ai";
import {
  and,
  count,
  desc,
  eq,
  gte,
  ilike,
  jobs,
  lt,
  lte,
  ocrCalls,
  ocrRounds,
  or,
  organization,
  receiptItems,
  receipts,
  sql,
  OCR_CALL_STATUSES,
  type DbClient,
  type NewOcrCall,
  type Receipt,
  type ReceiptItem,
  type SQL,
  user,
} from "@receipt-ocr/db";
import { Context, Effect, Layer } from "effect";
import type { DbError } from "./errors";
import { liveReceiptJob, STALE_AFTER_MS } from "./jobs/live";
import { enqueueJob } from "./jobs/queue";
import { PRIORITY_INTERACTIVE, receiptExtractJob } from "./jobs/receipt-extract-job";
import type { QuotaVerdict } from "./quota";
import { Db } from "./services";
import { countUsage, lockUserQuota, type UsageCounts, type UsageWindow } from "./usage";

export type ReceiptStatus = Receipt["status"];

/**
 * Receipts belong to a workspace: every member can read them. `userId` is
 * attribution and quota accounting; it never narrows reads, but it does
 * narrow a plain member's edits and deletes to their own uploads.
 */
export type ReceiptScope = {
  organizationId: string;
  userId: string;
  /**
   * Workspace role. Without owner or admin, only the uploader may edit or
   * delete; a receipt whose uploader was deleted (null `userId`) only an owner
   * or admin can.
   */
  role?: string;
};

/** Owners and admins may edit or delete any receipt in the workspace. Fails closed without a role. */
export const canManageAnyReceipt = (role: string | undefined) =>
  (role ?? "").split(",").some((r) => r.trim() === "owner" || r.trim() === "admin");

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Receipt ids are UUIDs; anything else can't match, and Postgres would reject the cast. */
export const isReceiptId = (id: string) => UUID.test(id);

export type ReceiptWithItems = Receipt & { items: ReceiptItem[]; imageUrl?: string };

/** A History row: table columns only, no items or raw extraction. */
export type ReceiptSummary = {
  id: string;
  status: ReceiptStatus;
  merchant: string | null;
  receiptDate: string | null;
  category: string | null;
  currency: string;
  total: string | null;
  confidence: number | null;
  fileName: string | null;
  errorMessage: string | null;
  createdAt: Date;
};

export type ReceiptExportRow = ReceiptSummary & {
  subtotal: string | null;
  tax: string | null;
  tip: string | null;
  itemCount: number;
};

export type ReceiptFilters = {
  q?: string;
  category?: string;
  status?: ReceiptStatus | "needs-review";
  /** Inclusive receipt-date bounds, YYYY-MM-DD. */
  from?: string;
  to?: string;
};

/** Fields a user may correct on an extracted receipt. */
export type ReceiptPatch = {
  merchant?: string | null;
  receiptDate?: string | null;
  category?: string | null;
  currency?: string | null;
  subtotal?: string | null;
  tax?: string | null;
  tip?: string | null;
  total?: string | null;
};

/** Workspace-wide counts for the home screen; `needsReview` and `failed` are what to act on. */
export type ReceiptCounts = {
  total: number;
  needsReview: number;
  failed: number;
  inFlight: number;
};

/** One `ocr_calls` row, built by the pipeline. */
export type OcrCallRow = Omit<NewOcrCall, "id" | "status"> & {
  userId: string | null;
  organizationId: string;
  status: (typeof OCR_CALL_STATUSES)[number];
};

/**
 * The quota check run under the user's lock, in the same transaction that
 * records the new round, so parallel requests can't all pass it.
 */
export type QuotaGate = {
  window: UsageWindow;
  decide: (counts: UsageCounts) => QuotaVerdict;
};

export type InsertResult =
  { kind: "inserted"; receipt: Receipt; jobId: string } | { kind: "quota"; verdict: QuotaVerdict };

export type RetryClaim =
  | { kind: "claimed"; round: number; jobId: string }
  | { kind: "quota"; verdict: QuotaVerdict }
  | { kind: "not-found" }
  | { kind: "not-retryable" }
  | { kind: "attempts-exhausted" };

/** Upload plus two retries: a receipt that keeps failing can't loop provider calls. */
export const MAX_EXTRACTION_ATTEMPTS = 3;

/** Completed receipts below this overall confidence are flagged "needs review". */
export const NEEDS_REVIEW_BELOW = 0.9;

/**
 * A `processing` receipt whose job is gone or long overdue (nothing ran the
 * queue, or a final-failure write was lost) reads as failed past this age, and
 * can be retried. While its job is live it reads as processing however long
 * it waits.
 */
export { STALE_AFTER_MS } from "./jobs/live";
export const STALE_MESSAGE = "Reading this receipt took too long. Try again.";
export const EXTRACTION_FAILED_MESSAGE =
  "We couldn't read this receipt. It may be blurry, cropped or too dark. Try again, or upload a clearer copy.";

const staleInterval = sql.raw(`interval '${STALE_AFTER_MS / 1000} seconds'`);
// Qualified by hand: Drizzle renders columns unqualified in a single-table
// select, and a bare `id` here would resolve to `jobs.id`.
const hasLiveJob = sql`exists (select 1 from jobs j where j.receipt_id = receipts.id and ${liveReceiptJob("j")})`;
const isStale = sql`(${receipts.status} in ('uploaded', 'processing') and ${receipts.updatedAt} < now() - ${staleInterval} and not ${hasLiveJob})`;
const effectiveStatus = sql<ReceiptStatus>`case when ${isStale} then 'failed' else ${receipts.status}::text end`;
const effectiveError = sql<
  string | null
>`case when ${isStale} then ${STALE_MESSAGE} else ${receipts.errorMessage} end`;

/** Old enough to be stale if no job is live for it; the caller checks the job. */
export function isStaleCandidate(row: Pick<Receipt, "status" | "updatedAt">, now = Date.now()) {
  return (
    (row.status === "uploaded" || row.status === "processing") &&
    row.updatedAt.getTime() < now - STALE_AFTER_MS
  );
}

/** Only the live attempt may write a result: a stale or duplicate run matches no row. */
const currentAttempt = (id: string, scope: ReceiptScope, attempt: number) =>
  and(inScope(id, scope), eq(receipts.status, "processing"), eq(receipts.attempts, attempt));

/** Every read and write is narrowed to the caller's workspace. */
const inScope = (id: string, scope: ReceiptScope) =>
  and(eq(receipts.id, id), eq(receipts.organizationId, scope.organizationId));

/** User edits and deletes: in the workspace, and the caller's own upload unless owner or admin. */
const writable = (id: string, scope: ReceiptScope) =>
  canManageAnyReceipt(scope.role)
    ? inScope(id, scope)
    : and(inScope(id, scope), eq(receipts.userId, scope.userId));

const escapeLike = (value: string) => value.replace(/[\\%_]/g, (c) => `\\${c}`);

function filterWhere(scope: ReceiptScope, filters: ReceiptFilters): SQL | undefined {
  const conditions: (SQL | undefined)[] = [eq(receipts.organizationId, scope.organizationId)];
  const q = filters.q?.trim();
  if (q) {
    const pattern = `%${escapeLike(q)}%`;
    conditions.push(or(ilike(receipts.merchant, pattern), ilike(receipts.fileName, pattern)));
  }
  if (filters.category) conditions.push(eq(receipts.category, filters.category));
  if (filters.status === "needs-review") {
    conditions.push(
      eq(receipts.status, "completed"),
      lt(receipts.confidence, String(NEEDS_REVIEW_BELOW)),
    );
  } else if (filters.status === "processing") {
    // Matches the Home "Reading now" count, which includes receipts not yet picked up.
    conditions.push(sql`${effectiveStatus} in ('uploaded', 'processing')`);
  } else if (filters.status) {
    conditions.push(sql`${effectiveStatus} = ${filters.status}`);
  }
  if (filters.from) conditions.push(gte(receipts.receiptDate, filters.from));
  if (filters.to) conditions.push(lte(receipts.receiptDate, filters.to));
  return and(...conditions);
}

const summaryColumns = {
  id: receipts.id,
  status: effectiveStatus,
  merchant: receipts.merchant,
  receiptDate: receipts.receiptDate,
  category: receipts.category,
  currency: receipts.currency,
  total: receipts.total,
  confidence: receipts.confidence,
  fileName: receipts.fileName,
  errorMessage: effectiveError,
  createdAt: receipts.createdAt,
};

type SummaryRow = {
  [K in keyof typeof summaryColumns]: K extends "status"
    ? ReceiptStatus
    : K extends "errorMessage"
      ? string | null
      : (typeof receipts.$inferSelect)[K & keyof typeof receipts.$inferSelect];
};

const toSummary = (row: SummaryRow): ReceiptSummary => ({
  ...row,
  currency: row.currency ?? "USD",
  confidence: row.confidence == null ? null : Number(row.confidence),
});

const decimal = (value: number | null) => (value == null ? null : String(value));

/**
 * Writes the calls of a round. The workspace or the user may have been
 * deleted while the model ran; the row is then kept unlinked (null) instead
 * of failing the transaction on the foreign key.
 */
async function recordCalls(tx: Pick<DbClient, "insert">, calls: readonly OcrCallRow[]) {
  if (calls.length === 0) return;
  await tx
    .insert(ocrCalls)
    .values(
      calls.map((call) => ({
        ...call,
        organizationId: sql`(select ${organization.id} from ${organization} where ${organization.id} = ${call.organizationId})`,
        userId:
          call.userId === null
            ? null
            : sql`(select ${user.id} from ${user} where ${user.id} = ${call.userId})`,
      })),
    )
    // An attempt's calls written twice (a lost COMMIT ack, then the failure path) count once.
    .onConflictDoNothing();
}

export class ReceiptRepo extends Context.Tag("@receipt-ocr/core/ReceiptRepo")<
  ReceiptRepo,
  {
    /**
     * Inserts an uploaded receipt straight into `processing` (its file is
     * already stored), records its first round and enqueues the job that
     * reads it, all in one transaction, if the quota allows. There is never a
     * receipt without a job, or a job without its quota.
     */
    readonly insert: (
      input: {
        id: string;
        scope: ReceiptScope;
        fileName: string;
        imageObjectKey: string;
        /** Job priority; interactive by default. */
        priority?: number;
      },
      quota: QuotaGate,
    ) => Effect.Effect<InsertResult, DbError>;
    /**
     * Persists an extraction, its items and the model that produced it. Only the
     * current attempt of a `processing` receipt may complete it; null when the
     * receipt is gone or a newer attempt or a final state superseded this one.
     * `calls` are recorded either way, in the same transaction: they were made.
     */
    readonly complete: (
      id: string,
      scope: ReceiptScope,
      attempt: number,
      extraction: ReceiptExtraction,
      model: string,
      calls: readonly OcrCallRow[],
    ) => Effect.Effect<ReceiptWithItems | null, DbError>;
    /**
     * Marks the current attempt failed; false when it is no longer the current
     * `processing` one. `calls` are recorded either way.
     */
    readonly fail: (
      id: string,
      scope: ReceiptScope,
      attempt: number,
      message: string,
      calls: readonly OcrCallRow[],
    ) => Effect.Effect<boolean, DbError>;
    /** Records calls of an attempt that didn't settle the receipt (its job will retry). */
    readonly recordCalls: (calls: readonly OcrCallRow[]) => Effect.Effect<void, DbError>;
    /**
     * Atomically moves a failed (or stale) receipt back to `processing`,
     * records the new round and enqueues its job, if the quota allows.
     */
    readonly claimRetry: (
      id: string,
      scope: ReceiptScope,
      quota: QuotaGate,
    ) => Effect.Effect<RetryClaim, DbError>;
    readonly get: (
      id: string,
      scope: ReceiptScope,
    ) => Effect.Effect<ReceiptWithItems | null, DbError>;
    readonly list: (
      scope: ReceiptScope,
      filters: ReceiptFilters,
      page: { limit: number; offset: number },
    ) => Effect.Effect<{ rows: ReceiptSummary[]; total: number }, DbError>;
    readonly counts: (scope: ReceiptScope) => Effect.Effect<ReceiptCounts, DbError>;
    readonly exportRows: (
      scope: ReceiptScope,
      filters: ReceiptFilters,
      limit: number,
    ) => Effect.Effect<ReceiptExportRow[], DbError>;
    /** Applies user corrections; false when nothing matched or the caller may not edit it. */
    readonly update: (
      id: string,
      scope: ReceiptScope,
      patch: ReceiptPatch,
    ) => Effect.Effect<boolean, DbError>;
    /** Deletes the row (items cascade); returns its object key, or null when nothing matched or not allowed. */
    readonly remove: (
      id: string,
      scope: ReceiptScope,
    ) => Effect.Effect<{ imageObjectKey: string | null } | null, DbError>;
    /** Object keys of every receipt in a workspace or uploaded by a user, before a cascade delete. */
    readonly objectKeys: (
      owner: { organizationId: string } | { userId: string },
    ) => Effect.Effect<string[], DbError>;
    readonly usage: (userId: string, window: UsageWindow) => Effect.Effect<UsageCounts, DbError>;
  }
>() {
  static readonly Live = Layer.effect(
    ReceiptRepo,
    Effect.map(Db, ({ use }) => ({
      insert: ({ id, scope, fileName, imageObjectKey, priority }, quota) =>
        use((db) =>
          db.transaction(async (tx): Promise<InsertResult> => {
            await lockUserQuota(tx, scope.userId);
            const verdict = quota.decide(await countUsage(tx, scope.userId, quota.window));
            if (!verdict.allowed) return { kind: "quota", verdict };
            const [row] = await tx
              .insert(receipts)
              .values({
                id,
                organizationId: scope.organizationId,
                userId: scope.userId,
                status: "processing",
                fileName,
                imageObjectKey,
              })
              .returning();
            if (!row) throw new Error("Insert returned no row");
            await tx.insert(ocrRounds).values({
              receiptId: id,
              organizationId: scope.organizationId,
              userId: scope.userId,
              round: 1,
            });
            const job = await enqueueJob(
              tx,
              receiptExtractJob(
                {
                  receiptId: id,
                  organizationId: scope.organizationId,
                  userId: scope.userId,
                  round: 1,
                },
                priority ?? PRIORITY_INTERACTIVE,
              ),
            );
            if (!("id" in job)) throw new Error("A new receipt already had a live job");
            return { kind: "inserted", receipt: row, jobId: job.id };
          }),
        ),

      complete: (id, scope, attempt, extraction, model, calls) =>
        use((db) =>
          db.transaction(async (tx) => {
            await recordCalls(tx, calls);
            const [row] = await tx
              .update(receipts)
              .set({
                status: "completed",
                merchant: extraction.merchant,
                receiptDate: extraction.receiptDate,
                category: normalizeCategory(extraction.category),
                currency: extraction.currency.toUpperCase(),
                subtotal: decimal(extraction.subtotal),
                tax: decimal(extraction.tax),
                tip: decimal(extraction.tip),
                total: String(extraction.total),
                confidence: String(extraction.confidence),
                rawJson: extraction,
                model,
                errorMessage: null,
                updatedAt: new Date(),
              })
              .where(currentAttempt(id, scope, attempt))
              .returning();
            if (!row) return null;
            await tx.delete(receiptItems).where(eq(receiptItems.receiptId, id));
            const items =
              extraction.items.length === 0
                ? []
                : await tx
                    .insert(receiptItems)
                    .values(
                      extraction.items.map((item) => ({
                        receiptId: id,
                        name: item.name,
                        quantity: Math.max(1, Math.round(item.quantity || 1)),
                        unitPrice: String(item.unitPrice),
                        totalPrice: String(item.totalPrice),
                        confidence: String(item.confidence),
                      })),
                    )
                    .returning();
            return { ...row, items };
          }),
        ),

      recordCalls: (calls) => use((db) => recordCalls(db, calls)),

      fail: (id, scope, attempt, message, calls) =>
        use((db) =>
          db.transaction(async (tx) => {
            await recordCalls(tx, calls);
            const rows = await tx
              .update(receipts)
              .set({ status: "failed", errorMessage: message, updatedAt: new Date() })
              .where(currentAttempt(id, scope, attempt))
              .returning({ id: receipts.id });
            return rows.length > 0;
          }),
        ),

      claimRetry: (id, scope, quota) =>
        use(async (db): Promise<RetryClaim> => {
          if (!isReceiptId(id)) return { kind: "not-found" };
          return db.transaction(async (tx): Promise<RetryClaim> => {
            await lockUserQuota(tx, scope.userId);
            const verdict = quota.decide(await countUsage(tx, scope.userId, quota.window));
            if (!verdict.allowed) return { kind: "quota", verdict };
            const now = new Date();
            const [claimed] = await tx
              .update(receipts)
              .set({
                status: "processing",
                errorMessage: null,
                attempts: sql`${receipts.attempts} + 1`,
                lastAttemptAt: now,
                updatedAt: now,
              })
              .where(
                and(
                  inScope(id, scope),
                  or(eq(receipts.status, "failed"), isStale),
                  lt(receipts.attempts, MAX_EXTRACTION_ATTEMPTS),
                ),
              )
              .returning({ attempts: receipts.attempts });
            if (claimed) {
              const round = claimed.attempts;
              await tx.insert(ocrRounds).values({
                receiptId: id,
                organizationId: scope.organizationId,
                userId: scope.userId,
                round,
              });
              // A job still live for an older round can no longer write (the
              // round fences it); end it so the new round's job can be enqueued.
              await tx
                .update(jobs)
                .set({
                  state: "cancelled",
                  lastErrorKind: "superseded",
                  lastErrorAt: now,
                  finishedAt: now,
                  lockedBy: null,
                  lockedUntil: null,
                  updatedAt: now,
                })
                .where(
                  // Overdue ones included: they are not live, but still hold the unique index.
                  sql`${jobs.receiptId} = ${id} and jobs.kind like 'receipt.%' and jobs.state in ('queued', 'running')`,
                );
              const job = await enqueueJob(
                tx,
                receiptExtractJob(
                  {
                    receiptId: id,
                    organizationId: scope.organizationId,
                    userId: scope.userId,
                    round,
                  },
                  PRIORITY_INTERACTIVE,
                ),
              );
              if (!("id" in job)) throw new Error("The new round's job collided with a live one");
              return { kind: "claimed", round, jobId: job.id };
            }
            const [existing] = await tx
              .select({ attempts: receipts.attempts })
              .from(receipts)
              .where(inScope(id, scope));
            if (!existing) return { kind: "not-found" };
            return existing.attempts >= MAX_EXTRACTION_ATTEMPTS
              ? { kind: "attempts-exhausted" }
              : { kind: "not-retryable" };
          });
        }),

      get: (id, scope) =>
        use(async (db) => {
          if (!isReceiptId(id)) return null;
          const row = await db.query.receipts.findFirst({
            where: inScope(id, scope),
            with: { items: true },
          });
          if (!row || !isStaleCandidate(row)) return row ?? null;
          const [live] = await db
            .select({ id: jobs.id })
            .from(jobs)
            .where(and(eq(jobs.receiptId, id), liveReceiptJob("jobs")))
            .limit(1);
          return live ? row : { ...row, status: "failed" as const, errorMessage: STALE_MESSAGE };
        }),

      list: (scope, filters, page) =>
        use(async (db) => {
          const where = filterWhere(scope, filters);
          const [rows, totals] = await Promise.all([
            db
              .select(summaryColumns)
              .from(receipts)
              .where(where)
              .orderBy(desc(receipts.createdAt), desc(receipts.id))
              .limit(page.limit)
              .offset(page.offset),
            db.select({ value: count() }).from(receipts).where(where),
          ]);
          return { rows: rows.map(toSummary), total: totals[0]?.value ?? 0 };
        }),

      counts: (scope) =>
        use(async (db) => {
          const [row] = await db
            .select({
              total: sql<number>`count(*)::int`,
              needsReview: sql<number>`(count(*) filter (where ${receipts.status} = 'completed' and ${receipts.confidence} < ${String(NEEDS_REVIEW_BELOW)}))::int`,
              failed: sql<number>`(count(*) filter (where ${effectiveStatus} = 'failed'))::int`,
              inFlight: sql<number>`(count(*) filter (where ${effectiveStatus} in ('uploaded', 'processing')))::int`,
            })
            .from(receipts)
            .where(eq(receipts.organizationId, scope.organizationId));
          return {
            total: row?.total ?? 0,
            needsReview: row?.needsReview ?? 0,
            failed: row?.failed ?? 0,
            inFlight: row?.inFlight ?? 0,
          };
        }),

      exportRows: (scope, filters, limit) =>
        use(async (db) => {
          const rows = await db
            .select({
              ...summaryColumns,
              subtotal: receipts.subtotal,
              tax: receipts.tax,
              tip: receipts.tip,
              // Qualified by hand: Drizzle renders columns unqualified in a single-table select.
              itemCount: sql<number>`(select count(*)::int from receipt_items where receipt_items.receipt_id = receipts.id)`,
            })
            .from(receipts)
            .where(filterWhere(scope, filters))
            .orderBy(desc(receipts.createdAt), desc(receipts.id))
            .limit(limit);
          return rows.map((row) => ({ ...row, ...toSummary(row) }));
        }),

      update: (id, scope, patch) =>
        use(async (db) => {
          if (!isReceiptId(id)) return false;
          const fields = Object.fromEntries(
            Object.entries(patch).filter(([, v]) => v !== undefined),
          );
          const [row] = await db
            .update(receipts)
            .set({ ...fields, updatedAt: new Date() })
            .where(writable(id, scope))
            .returning({ id: receipts.id });
          return Boolean(row);
        }),

      remove: (id, scope) =>
        use(async (db) => {
          if (!isReceiptId(id)) return null;
          const [row] = await db
            .delete(receipts)
            .where(writable(id, scope))
            .returning({ imageObjectKey: receipts.imageObjectKey });
          return row ?? null;
        }),

      objectKeys: (owner) =>
        use(async (db) => {
          const rows = await db
            .select({ key: receipts.imageObjectKey })
            .from(receipts)
            .where(
              "organizationId" in owner
                ? eq(receipts.organizationId, owner.organizationId)
                : eq(receipts.userId, owner.userId),
            );
          return rows.flatMap((row) => (row.key ? [row.key] : []));
        }),

      usage: (userId, window) => use((db) => countUsage(db, userId, window)),
    })),
  );
}
