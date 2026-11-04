import { normalizeCategory, type ReceiptExtraction } from "@receipt-ocr/ai";
import {
  and,
  count,
  desc,
  eq,
  gte,
  ilike,
  lt,
  lte,
  or,
  receiptItems,
  receipts,
  sql,
  type Receipt,
  type ReceiptItem,
  type SQL,
} from "@receipt-ocr/db";
import { Context, Effect, Layer } from "effect";
import type { DbError } from "./errors";
import { Db } from "./services";

export type ReceiptStatus = Receipt["status"];

/**
 * Receipts belong to a workspace: every member can read and act on them.
 * `userId` is attribution and quota accounting only; it never narrows reads.
 */
export type ReceiptScope = {
  organizationId: string;
  userId: string;
  /** Workspace role. Plain members may delete only receipts they uploaded. */
  role?: string;
};

const canDeleteAny = (scope: ReceiptScope) => scope.role !== "member";

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

export type UsageCounts = { userMinute: number; userDay: number; globalDay: number | null };

export type RetryClaim =
  | { kind: "claimed"; imageObjectKey: string | null }
  | { kind: "not-found" }
  | { kind: "not-retryable" }
  | { kind: "attempts-exhausted" };

/** Upload plus two retries: a receipt that keeps failing can't loop provider calls. */
export const MAX_EXTRACTION_ATTEMPTS = 3;

/** Completed receipts below this overall confidence are flagged "needs review". */
export const NEEDS_REVIEW_BELOW = 0.9;

/**
 * An upload whose function was killed mid-extraction never reaches a final
 * state. Past this age (well beyond the route's maxDuration) it reads as
 * failed and can be retried.
 */
export const STALE_AFTER_MS = 5 * 60_000;
export const STALE_MESSAGE = "Reading this receipt took too long. Try again.";
export const EXTRACTION_FAILED_MESSAGE =
  "We couldn't read this receipt. It may be blurry, cropped or too dark. Try again, or upload a clearer copy.";

const staleInterval = sql.raw(`interval '${STALE_AFTER_MS / 1000} seconds'`);
const isStale = sql`(${receipts.status} in ('uploaded', 'processing') and ${receipts.updatedAt} < now() - ${staleInterval})`;
const effectiveStatus = sql<ReceiptStatus>`case when ${isStale} then 'failed' else ${receipts.status}::text end`;
const effectiveError = sql<
  string | null
>`case when ${isStale} then ${STALE_MESSAGE} else ${receipts.errorMessage} end`;

export function isStaleReceipt(row: Pick<Receipt, "status" | "updatedAt">, now = Date.now()) {
  return (
    (row.status === "uploaded" || row.status === "processing") &&
    row.updatedAt.getTime() < now - STALE_AFTER_MS
  );
}

/** Every read and write is narrowed to the caller's workspace. */
const inScope = (id: string, scope: ReceiptScope) =>
  and(eq(receipts.id, id), eq(receipts.organizationId, scope.organizationId));

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

export class ReceiptRepo extends Context.Tag("@receipt-ocr/core/ReceiptRepo")<
  ReceiptRepo,
  {
    /** Inserts an uploaded receipt straight into `processing`; its file is already stored. */
    readonly insert: (input: {
      id: string;
      scope: ReceiptScope;
      fileName: string;
      imageObjectKey: string;
    }) => Effect.Effect<Receipt, DbError>;
    /** Persists an extraction and its items; null when the receipt no longer exists. */
    readonly complete: (
      id: string,
      scope: ReceiptScope,
      extraction: ReceiptExtraction,
    ) => Effect.Effect<ReceiptWithItems | null, DbError>;
    readonly fail: (
      id: string,
      scope: ReceiptScope,
      message: string,
    ) => Effect.Effect<void, DbError>;
    /** Atomically moves a failed (or stale) receipt back to `processing`. */
    readonly claimRetry: (id: string, scope: ReceiptScope) => Effect.Effect<RetryClaim, DbError>;
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
    /** Applies user corrections; false when nothing matched. */
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
    readonly usage: (input: {
      userId: string;
      dayStart: Date;
      minuteStart: Date;
      includeGlobal: boolean;
    }) => Effect.Effect<UsageCounts, DbError>;
  }
>() {
  static readonly Live = Layer.effect(
    ReceiptRepo,
    Effect.map(Db, ({ use }) => ({
      insert: ({ id, scope, fileName, imageObjectKey }) =>
        use(async (db) => {
          const [row] = await db
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
          return row;
        }),

      complete: (id, scope, extraction) =>
        use((db) =>
          db.transaction(async (tx) => {
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
                errorMessage: null,
                updatedAt: new Date(),
              })
              .where(inScope(id, scope))
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

      fail: (id, scope, message) =>
        use(async (db) => {
          await db
            .update(receipts)
            .set({ status: "failed", errorMessage: message, updatedAt: new Date() })
            .where(inScope(id, scope));
        }),

      claimRetry: (id, scope) =>
        use(async (db): Promise<RetryClaim> => {
          const now = new Date();
          const [claimed] = await db
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
            .returning({ imageObjectKey: receipts.imageObjectKey });
          if (claimed) return { kind: "claimed", imageObjectKey: claimed.imageObjectKey };
          const [existing] = await db
            .select({ attempts: receipts.attempts })
            .from(receipts)
            .where(inScope(id, scope));
          if (!existing) return { kind: "not-found" };
          return existing.attempts >= MAX_EXTRACTION_ATTEMPTS
            ? { kind: "attempts-exhausted" }
            : { kind: "not-retryable" };
        }),

      get: (id, scope) =>
        use(async (db) => {
          const row = await db.query.receipts.findFirst({
            where: inScope(id, scope),
            with: { items: true },
          });
          if (!row) return null;
          return isStaleReceipt(row)
            ? { ...row, status: "failed" as const, errorMessage: STALE_MESSAGE }
            : row;
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
          const fields = Object.fromEntries(
            Object.entries(patch).filter(([, v]) => v !== undefined),
          );
          const [row] = await db
            .update(receipts)
            .set({ ...fields, updatedAt: new Date() })
            .where(inScope(id, scope))
            .returning({ id: receipts.id });
          return Boolean(row);
        }),

      remove: (id, scope) =>
        use(async (db) => {
          const [row] = await db
            .delete(receipts)
            .where(
              canDeleteAny(scope)
                ? inScope(id, scope)
                : and(inScope(id, scope), eq(receipts.userId, scope.userId)),
            )
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

      usage: ({ userId, dayStart, minuteStart, includeGlobal }) =>
        use(async (db) => {
          const since = new Date(Math.min(dayStart.getTime(), minuteStart.getTime())).toISOString();
          const day = dayStart.toISOString();
          const minute = minuteStart.toISOString();
          const mine = sql`${receipts.userId} = ${userId}`;
          const retriedSince = (at: string) => sql`${receipts.lastAttemptAt} >= ${at}::timestamptz`;
          // Failed (and stale) receipts don't count against the user's day:
          // a bad photo shouldn't cost them a slot. The burst and global
          // counts include them, since each one still called the provider.
          const [row] = await db
            .select({
              userMinute: sql<number>`(count(*) filter (where ${mine} and ${receipts.createdAt} >= ${minute}::timestamptz) + count(*) filter (where ${mine} and ${retriedSince(minute)}))::int`,
              userDay: sql<number>`count(*) filter (where ${mine} and ${receipts.createdAt} >= ${day}::timestamptz and ${receipts.status} <> 'failed' and not ${isStale})::int`,
              globalDay: sql<number>`(count(*) filter (where ${receipts.createdAt} >= ${day}::timestamptz) + count(*) filter (where ${retriedSince(day)}))::int`,
            })
            .from(receipts)
            .where(
              includeGlobal
                ? sql`(${receipts.createdAt} >= ${since}::timestamptz or ${retriedSince(since)})`
                : sql`${mine} and (${receipts.createdAt} >= ${since}::timestamptz or ${retriedSince(since)})`,
            );
          return {
            userMinute: row?.userMinute ?? 0,
            userDay: row?.userDay ?? 0,
            globalDay: includeGlobal ? (row?.globalDay ?? 0) : null,
          };
        }),
    })),
  );
}
