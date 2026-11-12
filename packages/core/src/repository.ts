import { normalizeCategory, type ReceiptExtraction } from "@receipt-ocr/ai";
import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  jobs,
  lt,
  lte,
  MAX_EXTRACTION_ATTEMPTS,
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
import { DbError, InvalidInput } from "./errors";
import { liveReceiptJob, STALE_AFTER_MS } from "./jobs/live";
import { enqueueJob } from "./jobs/queue";
import { PRIORITY_INTERACTIVE, receiptExtractJob } from "./jobs/receipt-extract-job";
import { storageDeleteJob } from "./jobs/storage-delete-job";
import { MAX_BULK_DELETE } from "./bulk-limits";
import type { QuotaVerdict } from "./quota";
import { Db } from "./services";
import {
  countUsage,
  lockQuota,
  type UsageCounts,
  type UsageSubject,
  type UsageWindow,
} from "./usage";
import { isUuid } from "./ids";
import {
  isIsoDay,
  parseCurrency,
  parseReceiptDate,
  storableAmount,
  storableQuantity,
} from "./receipt-fields";

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
  /** The admin acting as this user, when impersonating; product analytics skips their work. */
  impersonatedBy?: string;
};

/** Owners and admins may edit or delete any receipt in the workspace. Fails closed without a role. */
export const canManageAnyReceipt = (role: string | undefined) =>
  (role ?? "").split(",").some((r) => r.trim() === "owner" || r.trim() === "admin");

/** Receipt ids are UUIDs; anything else can't match, and Postgres would reject the cast. */
export const isReceiptId = isUuid;

export type ReceiptWithItems = Receipt & {
  items: ReceiptItem[];
  imageUrl?: string;
  /** Who marked it reviewed; set by `get`, null once that user is deleted. */
  reviewer?: { name: string } | null;
};

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
  /** The uploader; null once their account is deleted. */
  userId: string | null;
  /** Set on list rows: the uploader's name, null once their account is deleted. */
  uploaderName?: string | null;
  /** When someone marked it reviewed; null until then, and again after a new extraction. */
  reviewedAt: Date | null;
  /** Set on list rows: who marked it reviewed, null once their account is deleted. */
  reviewerName?: string | null;
  /** Set on list rows: when a processing receipt's job next runs, if that is still ahead (waiting to retry). */
  retryAt?: Date | null;
};

export type ReceiptExportRow = ReceiptSummary & {
  subtotal: string | null;
  tax: string | null;
  tip: string | null;
  itemCount: number;
  /** Names of the receipt's groups, alphabetical. */
  groups: string[];
};

export type ReceiptFilters = {
  q?: string;
  category?: string;
  status?: ReceiptStatus | "needs-review";
  /** Inclusive receipt-date bounds, YYYY-MM-DD. */
  from?: string;
  to?: string;
  /** Group ids: receipts in any of them. */
  groups?: string[];
  /** Only these receipts (a selection); ids that aren't UUIDs match nothing. */
  ids?: string[];
};

/** History's sort orders; `uploaded` (newest first) is the default. */
export type ReceiptSort = {
  by: "uploaded" | "date" | "total" | "merchant";
  dir: "asc" | "desc";
};

const NEWEST_FIRST: ReceiptSort = { by: "uploaded", dir: "desc" };

export { MAX_BULK_DELETE };

/**
 * What a bulk delete removes: chosen receipts, or every receipt matching History's filters.
 * `expected` is the match count the user confirmed; a different count now means the list
 * changed under them, and nothing is deleted.
 */
export type DeleteTarget =
  { ids: readonly string[] } | { filters: ReceiptFilters; expected: number };

export type BulkDeleteResult =
  | {
      kind: "deleted";
      deleted: string[];
      /** In the workspace, but the caller may not delete them (someone else's upload). */
      skipped: number;
      /** Ids not in this workspace (or gone already). Always 0 for a filter. */
      notFound: number;
      /** The job deleting the stored files; null when none had a file. */
      jobId: string | null;
    }
  | { kind: "changed"; matched: number }
  | { kind: "too-many"; deletable: number };

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
 * The quota check run under the quota lock (the user's, and the workspace's on a pooled plan), in the same transaction that
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

/** Thrown inside the bulk delete transaction to roll it back. */
class ListChanged extends Error {
  constructor(readonly matched: number) {
    super("The receipts changed during the delete");
  }
}

/** Upload plus two retries: a receipt that keeps failing can't loop provider calls. */
export { MAX_EXTRACTION_ATTEMPTS };

/** Completed receipts below this overall confidence are flagged "needs review" until someone reviews them. */
export const NEEDS_REVIEW_BELOW = 0.9;

const needsReview = sql`${receipts.status} = 'completed' and ${receipts.confidence} < ${String(NEEDS_REVIEW_BELOW)} and ${receipts.reviewedAt} is null`;

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

/** What the caller may edit or delete within the workspace: their own uploads unless owner or admin. */
const ownUnlessManager = (scope: ReceiptScope) =>
  canManageAnyReceipt(scope.role) ? undefined : eq(receipts.userId, scope.userId);

const writable = (id: string, scope: ReceiptScope) =>
  and(inScope(id, scope), ownUnlessManager(scope));

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
    conditions.push(needsReview);
  } else if (filters.status === "processing") {
    // Matches the Home "Reading now" count, which includes receipts not yet picked up.
    conditions.push(sql`${effectiveStatus} in ('uploaded', 'processing')`);
  } else if (filters.status) {
    conditions.push(sql`${effectiveStatus} = ${filters.status}`);
  }
  // Only real days reach the date comparison, where Postgres would reject the rest.
  if (filters.from && isIsoDay(filters.from))
    conditions.push(gte(receipts.receiptDate, filters.from));
  if (filters.to && isIsoDay(filters.to)) conditions.push(lte(receipts.receiptDate, filters.to));
  if (filters.ids) {
    const ids = filters.ids.filter(isReceiptId);
    conditions.push(ids.length > 0 ? inArray(receipts.id, ids) : sql`false`);
  }
  const groupIds = filters.groups?.filter(isReceiptId) ?? [];
  if (groupIds.length > 0) {
    // Qualified by hand, as in exportRows. The group must also be this workspace's.
    conditions.push(
      sql`exists (select 1 from receipt_group_members m join receipt_groups g on g.id = m.group_id where m.receipt_id = receipts.id and g.organization_id = ${scope.organizationId} and m.group_id in (${sql.join(
        groupIds.map((id) => sql`${id}::uuid`),
        sql`, `,
      )}))`,
    );
  }
  return and(...conditions);
}

/** A processing receipt's job is queued for later: a retry's backoff or a provider cooldown. */
const retryAtColumn = sql<
  Date | string | null
>`case when ${receipts.status} = 'processing' then (select min(j.run_at) from jobs j where j.receipt_id = receipts.id and j.kind like 'receipt.%' and j.state = 'queued' and j.run_at > now()) end`;

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
  userId: receipts.userId,
  reviewedAt: receipts.reviewedAt,
};

// Qualified by hand, as above.
const uploaderNameColumn = sql<
  string | null
>`(select u.name from "user" u where u.id = receipts.user_id)`;
const reviewerNameColumn = sql<
  string | null
>`(select u.name from "user" u where u.id = receipts.reviewed_by)`;

/**
 * A total order for offset paging: the sort key (missing values last either way), then the
 * id. Newest-first keeps the plain form the `(organization_id, created_at)` index serves.
 */
function sortOrder({ by, dir }: ReceiptSort): SQL[] {
  const order = dir === "asc" ? asc : desc;
  if (by === "uploaded") return [order(receipts.createdAt), order(receipts.id)];
  const key =
    by === "date"
      ? receipts.receiptDate
      : by === "total"
        ? receipts.total
        : sql`lower(${receipts.merchant})`;
  return [sql`${key} ${dir === "asc" ? sql`asc` : sql`desc`} nulls last`, order(receipts.id)];
}

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

/** The latest receipt date the row's `receipts_receipt_date_check` allows: a day past the UTC upload day. */
const latestReceiptDate = sql`(${receipts.createdAt} at time zone 'UTC')::date + 1`;

/**
 * An extracted date, or null when it is after the upload: a misread, or a
 * Bikram Sambat year (2080) given as AD. Null shows as "No date found".
 */
const plausibleDate = (date: string | null) =>
  date === null
    ? null
    : sql`case when ${date}::date <= ${latestReceiptDate} then ${date}::date end`;

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
    /**
     * One page, newest upload first unless `sort` says otherwise. `total` (all matches) is
     * null when the page asks for none.
     */
    readonly list: (
      scope: ReceiptScope,
      filters: ReceiptFilters,
      page: { limit: number; offset: number; total?: boolean; sort?: ReceiptSort },
    ) => Effect.Effect<{ rows: ReceiptSummary[]; total: number | null }, DbError>;
    /** Ids of the receipts matching `filters`, in `sort` order, at most `limit`. */
    readonly matchingIds: (
      scope: ReceiptScope,
      filters: ReceiptFilters,
      limit: number,
      sort?: ReceiptSort,
    ) => Effect.Effect<string[], DbError>;
    readonly counts: (scope: ReceiptScope) => Effect.Effect<ReceiptCounts, DbError>;
    readonly exportRows: (
      scope: ReceiptScope,
      filters: ReceiptFilters,
      limit: number,
      sort?: ReceiptSort,
    ) => Effect.Effect<ReceiptExportRow[], DbError>;
    /**
     * Applies user corrections; false when nothing matched or the caller may not
     * edit it. Fails InvalidInput for a date that isn't a real day from 2000 on,
     * or is after the day the receipt was uploaded.
     */
    readonly update: (
      id: string,
      scope: ReceiptScope,
      patch: ReceiptPatch,
    ) => Effect.Effect<boolean, DbError | InvalidInput>;
    /**
     * Marks a completed receipt reviewed by the caller (now), or clears that.
     * While impersonating, the admin (`impersonatedBy`) is recorded as the
     * reviewer. False when nothing matched, the receipt isn't completed, or the
     * caller may not edit it. Edits keep the
     * flag; a new extraction (`complete`) clears it.
     */
    readonly setReviewed: (
      id: string,
      scope: ReceiptScope,
      reviewed: boolean,
    ) => Effect.Effect<boolean, DbError>;
    /**
     * Deletes the receipts the caller may delete (items and group memberships cascade) and
     * enqueues one job for their stored files, in one transaction. Others' uploads are
     * skipped for a plain member; other workspaces' ids count as not found. Refuses, deleting
     * nothing, over MAX_BULK_DELETE or when a filter's match count isn't `expected`.
     */
    readonly removeMany: (
      scope: ReceiptScope,
      target: DeleteTarget,
    ) => Effect.Effect<BulkDeleteResult, DbError>;
    /** Object keys of every receipt in a workspace or uploaded by a user, before a cascade delete. */
    readonly objectKeys: (
      owner: { organizationId: string } | { userId: string },
    ) => Effect.Effect<string[], DbError>;
    readonly usage: (
      subject: UsageSubject,
      window: UsageWindow,
    ) => Effect.Effect<UsageCounts, DbError>;
  }
>() {
  static readonly Live = Layer.effect(
    ReceiptRepo,
    Effect.map(Db, ({ use }) => ({
      insert: ({ id, scope, fileName, imageObjectKey, priority }, quota) => {
        // Drizzle sends COMMIT only once the callback returns: a failure after
        // this is set may have committed the row.
        let committing = false;
        return use((db) =>
          db.transaction(async (tx): Promise<InsertResult> => {
            await lockQuota(tx, scope, quota.window.scope === "workspace");
            const verdict = quota.decide(await countUsage(tx, scope, quota.window));
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
              plan: quota.window.plan,
            });
            const job = await enqueueJob(
              tx,
              receiptExtractJob(
                {
                  receiptId: id,
                  organizationId: scope.organizationId,
                  userId: scope.userId,
                  round: 1,
                  ...(scope.impersonatedBy ? { impersonatedBy: scope.impersonatedBy } : {}),
                },
                priority ?? PRIORITY_INTERACTIVE,
              ),
            );
            if (!("id" in job)) throw new Error("A new receipt already had a live job");
            committing = true;
            return { kind: "inserted", receipt: row, jobId: job.id };
          }),
        ).pipe(
          Effect.mapError((error) =>
            committing
              ? new DbError({ message: error.message, cause: error.cause, atCommit: true })
              : error,
          ),
        );
      },

      complete: (id, scope, attempt, extraction, model, calls) =>
        use((db) =>
          db.transaction(async (tx) => {
            await recordCalls(tx, calls);
            const [row] = await tx
              .update(receipts)
              .set({
                status: "completed",
                merchant: extraction.merchant,
                receiptDate: plausibleDate(parseReceiptDate(extraction.receiptDate)),
                category: normalizeCategory(extraction.category),
                currency: parseCurrency(extraction.currency),
                subtotal: storableAmount(extraction.subtotal),
                tax: storableAmount(extraction.tax),
                tip: storableAmount(extraction.tip),
                total: storableAmount(extraction.total),
                confidence: String(extraction.confidence),
                rawJson: extraction,
                model,
                errorMessage: null,
                // A review vouched for the previous values, not these.
                reviewedAt: null,
                reviewedBy: null,
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
                        quantity: storableQuantity(item.quantity),
                        unitPrice: storableAmount(item.unitPrice),
                        totalPrice: storableAmount(item.totalPrice),
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
            await lockQuota(tx, scope, quota.window.scope === "workspace");
            const verdict = quota.decide(await countUsage(tx, scope, quota.window));
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
                plan: quota.window.plan,
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
                  // The claim above only matched a failed or stale receipt, so by
                  // `liveReceiptJob` none of these is live any more (an orphan, or an
                  // older round's leftover); they still hold the unique index.
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
                    ...(scope.impersonatedBy ? { impersonatedBy: scope.impersonatedBy } : {}),
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
            with: { items: true, reviewer: { columns: { name: true } } },
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
              .select({
                ...summaryColumns,
                retryAt: retryAtColumn,
                uploaderName: uploaderNameColumn,
                reviewerName: reviewerNameColumn,
              })
              .from(receipts)
              .where(where)
              .orderBy(...sortOrder(page.sort ?? NEWEST_FIRST))
              .limit(page.limit)
              .offset(page.offset),
            page.total === false ? null : db.select({ value: count() }).from(receipts).where(where),
          ]);
          return {
            rows: rows.map((row) => ({
              ...toSummary(row),
              retryAt: row.retryAt ? new Date(row.retryAt) : null,
            })),
            total: totals ? (totals[0]?.value ?? 0) : null,
          };
        }),

      matchingIds: (scope, filters, limit, sort = NEWEST_FIRST) =>
        use(async (db) => {
          const rows = await db
            .select({ id: receipts.id })
            .from(receipts)
            .where(filterWhere(scope, filters))
            .orderBy(...sortOrder(sort))
            .limit(limit);
          return rows.map((row) => row.id);
        }),

      counts: (scope) =>
        use(async (db) => {
          const [row] = await db
            .select({
              total: sql<number>`count(*)::int`,
              needsReview: sql<number>`(count(*) filter (where ${needsReview}))::int`,
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

      exportRows: (scope, filters, limit, sort = NEWEST_FIRST) =>
        use(async (db) => {
          const rows = await db
            .select({
              ...summaryColumns,
              subtotal: receipts.subtotal,
              tax: receipts.tax,
              tip: receipts.tip,
              // Qualified by hand: Drizzle renders columns unqualified in a single-table select.
              itemCount: sql<number>`(select count(*)::int from receipt_items where receipt_items.receipt_id = receipts.id)`,
              groups: sql<
                string[]
              >`array(select g.name from receipt_group_members m join receipt_groups g on g.id = m.group_id where m.receipt_id = receipts.id and g.organization_id = ${scope.organizationId} order by lower(g.name))`,
            })
            .from(receipts)
            .where(filterWhere(scope, filters))
            .orderBy(...sortOrder(sort))
            .limit(limit);
          return rows.map((row) => ({ ...row, ...toSummary(row) }));
        }),

      update: (id, scope, patch) => {
        const date = patch.receiptDate;
        if (date != null && parseReceiptDate(date) !== date) {
          return Effect.fail(
            new InvalidInput({ message: "Enter a real date from 2000 on, as YYYY-MM-DD." }),
          );
        }
        return Effect.flatMap(
          use(async (db) => {
            if (!isReceiptId(id)) return false;
            const fields = Object.fromEntries(
              Object.entries(patch).filter(([, v]) => v !== undefined),
            );
            const [row] = await db
              .update(receipts)
              .set({ ...fields, updatedAt: new Date() })
              .where(
                and(
                  writable(id, scope),
                  date == null ? undefined : sql`${date}::date <= ${latestReceiptDate}`,
                ),
              )
              .returning({ id: receipts.id });
            if (row || date == null) return Boolean(row);
            // Tell a date after the upload apart from a receipt the caller can't edit.
            const [editable] = await db
              .select({ id: receipts.id })
              .from(receipts)
              .where(writable(id, scope));
            return editable ? ("date-after-upload" as const) : false;
          }),
          (result) =>
            result === "date-after-upload"
              ? Effect.fail(
                  new InvalidInput({
                    message: "The date can't be after the day the receipt was uploaded.",
                  }),
                )
              : Effect.succeed(result),
        );
      },

      setReviewed: (id, scope, reviewed) =>
        use(async (db) => {
          if (!isReceiptId(id)) return false;
          const rows = await db
            .update(receipts)
            .set(
              reviewed
                ? // An admin signed in as the user is the one vouching for the values.
                  { reviewedAt: sql`now()`, reviewedBy: scope.impersonatedBy ?? scope.userId }
                : { reviewedAt: null, reviewedBy: null },
            )
            .where(and(writable(id, scope), eq(receipts.status, "completed")))
            .returning({ id: receipts.id });
          return rows.length > 0;
        }),

      removeMany: (scope, target) =>
        use(async (db): Promise<BulkDeleteResult> => {
          const ids =
            "filters" in target ? null : [...new Set(target.ids.map((id) => id.toLowerCase()))];
          const match = filterWhere(
            scope,
            "filters" in target ? { ...target.filters, ids: undefined } : { ids: ids ?? [] },
          );
          const mine = ownUnlessManager(scope);
          const deleting = db.transaction(async (tx): Promise<BulkDeleteResult> => {
            const [counted] = await tx
              .select({
                matched: sql<number>`count(*)::int`,
                deletable: mine
                  ? sql<number>`(count(*) filter (where ${mine}))::int`
                  : sql<number>`count(*)::int`,
              })
              .from(receipts)
              .where(match);
            const matched = counted?.matched ?? 0;
            const deletable = counted?.deletable ?? 0;
            if ("expected" in target && matched !== target.expected) {
              return { kind: "changed", matched };
            }
            if (deletable > MAX_BULK_DELETE) return { kind: "too-many", deletable };
            const rows =
              deletable === 0
                ? []
                : await tx
                    .delete(receipts)
                    .where(and(match, mine))
                    .returning({ id: receipts.id, key: receipts.imageObjectKey });
            // Rows can change between the count and the delete (read committed). A filter
            // delete must remove exactly what was confirmed; and never more than one job's keys.
            if (
              rows.length > MAX_BULK_DELETE ||
              ("expected" in target && rows.length !== deletable)
            ) {
              throw new ListChanged(matched);
            }
            const keys = rows.flatMap((row) => (row.key ? [row.key] : []));
            const job =
              keys.length > 0
                ? await enqueueJob(tx, storageDeleteJob(keys, scope.organizationId))
                : null;
            return {
              kind: "deleted",
              deleted: rows.map((row) => row.id),
              skipped: Math.max(0, matched - rows.length),
              notFound: ids ? Math.max(0, ids.length - matched) : 0,
              jobId: job && "id" in job ? job.id : null,
            };
          });
          try {
            return await deleting;
          } catch (error) {
            if (error instanceof ListChanged) return { kind: "changed", matched: error.matched };
            throw error;
          }
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

      usage: (subject, window) => use((db) => countUsage(db, subject, window)),
    })),
  );
}
