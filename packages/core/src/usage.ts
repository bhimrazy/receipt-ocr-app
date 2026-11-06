import {
  and,
  desc,
  eq,
  gte,
  isNotNull,
  ocrCalls,
  organization,
  sql,
  type DbClient,
  type SQL,
} from "@receipt-ocr/db";
import { Effect } from "effect";
import { liveReceiptJob } from "./jobs/live";
import { FREE_FAILED_ROUNDS } from "./plans";
import { isReceiptId } from "./repository";
import { Db } from "./services";

/**
 * Usage counted from the append-only ledger (`ocr_rounds`, `ocr_calls`), never
 * from `receipts`, so deleting a receipt or a workspace gives nothing back.
 *
 * - A round is one upload or one retry, recorded when it is accepted.
 * - A user's day: receipts read successfully that day, counted once, plus
 *   rounds still in flight (their job is live, or they are recent with no
 *   calls yet), plus finished failed rounds beyond the first
 *   `FREE_FAILED_ROUNDS` of the day. A few bad photos are free; a stream of
 *   them (each one a paid model call) is not.
 * - The burst limit counts rounds, failed ones included. The global cap
 *   counts rounds plus model-calling retry attempts: each one costs.
 */

export type UsageCounts = { userMinute: number; userDay: number; globalDay: number | null };

export type UsageWindow = {
  dayStart: Date;
  minuteStart: Date;
  /** Rounds younger than this with no calls yet are in flight. */
  pendingSince: Date;
  includeGlobal: boolean;
};

/** A database handle or an open transaction. */
export type Queryable = Pick<DbClient, "execute">;

const ts = (date: Date) => sql`${date.toISOString()}::timestamptz`;

/** The round (aliased `r`) has at least one successful call. */
const readOk = sql`exists (select 1 from ocr_calls c where c.receipt_id = r.receipt_id and c.round = r.round and c.status = 'ok')`;
/** The round has no calls yet: waiting or running (or died, until it ages out). */
const noCalls = sql`not exists (select 1 from ocr_calls c where c.receipt_id = r.receipt_id and c.round = r.round)`;
/**
 * The round's own job is queued or running (waiting, or between automatic
 * retries): in flight whatever calls it has made, so neither a backlog nor a
 * failed first attempt makes room in the quota. A long-overdue job stops
 * counting (see `liveReceiptJob`), so an orphaned one can't hold quota.
 */
const liveJobForRound = sql`exists (select 1 from jobs j where j.receipt_id = r.receipt_id and ${liveReceiptJob("j")} and (j.payload->>'round')::int = r.round)`;
/** The round is over, called a model and none succeeded: paid for, nothing read. */
const failedPaid = sql`(not ${readOk} and not ${liveJobForRound} and exists (select 1 from ocr_calls c where c.receipt_id = r.receipt_id and c.round = r.round and c.model is not null))`;

/**
 * A user's "used today" (see the rules above) as a scalar subquery.
 * `pendingSince` null leaves rounds in flight out (admin lists).
 */
export const usedSinceSql = (userId: SQL | string, since: Date, pendingSince: Date | null) => {
  const inFlight =
    pendingSince === null
      ? sql`false`
      : sql`(${liveJobForRound} or (r.created_at >= ${ts(pendingSince)} and ${noCalls}))`;
  const mine = sql`r.user_id = ${userId} and r.created_at >= ${ts(since)}`;
  return sql<number>`((select count(distinct r.receipt_id) from ocr_rounds r where ${mine} and (${readOk} or ${inFlight}))
    + greatest(0, (select count(*) from ocr_rounds r where ${mine} and ${failedPaid}) - ${FREE_FAILED_ROUNDS}))::int`;
};

export async function countUsage(
  db: Queryable,
  userId: string,
  window: UsageWindow,
): Promise<UsageCounts> {
  const global = window.includeGlobal ? roundsSince(window.dayStart) : sql`null::int`;
  const rows = await db.execute<{
    user_minute: number;
    user_day: number;
    global_day: number | null;
  }>(sql`select
    (select count(*)::int from ocr_rounds r
      where r.user_id = ${userId} and r.created_at >= ${ts(window.minuteStart)}) as user_minute,
    ${usedSinceSql(userId, window.dayStart, window.pendingSince)} as user_day,
    ${global} as global_day`);
  const row = rows[0];
  return {
    userMinute: row?.user_minute ?? 0,
    userDay: row?.user_day ?? 0,
    globalDay: window.includeGlobal ? (row?.global_day ?? 0) : null,
  };
}

/** Serializes one user's quota check and reservation; released at commit. */
export const lockUserQuota = (db: Queryable, userId: string) =>
  db.execute(sql`select pg_advisory_xact_lock(${QUOTA_LOCK_NAMESPACE}, hashtext(${userId}))`);

/** First key of the two-key advisory lock, so these locks can't collide with others. */
const QUOTA_LOCK_NAMESPACE = 7_301;

/** Per-user "used today" for admin lists: the quota's rule without rounds in flight. */
export const receiptsReadSince = (userColumn: SQL, since: Date) =>
  usedSinceSql(userColumn, since, null);

/**
 * What OCR_DAILY_CAP is checked against, all users since `since`: rounds
 * started, plus each automatic retry attempt that called a model. A round
 * can make up to four attempts, and the cap bounds spend, not uploads.
 */
export const roundsSince = (since: Date) =>
  sql<number>`((select count(*) from ocr_rounds r where r.created_at >= ${ts(since)})
    + (select count(*) from (select distinct c.receipt_id, c.round, c.job_attempt from ocr_calls c
        where c.created_at >= ${ts(since)} and c.job_attempt > 1 and c.model is not null) retries))::int`;

// ---------- Rollups for usage pages ----------

/**
 * Which calls a rollup covers. A workspace page passes the caller's active
 * workspace; only platform admins may ask for "all".
 */
export type UsageScope = { organizationId: string } | "all";

export type UsageTotals = {
  /** Distinct receipts with a successful call. */
  receipts: number;
  calls: number;
  failedCalls: number;
  inputTokens: number;
  cachedInputTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  /** Sum of known costs, micro-USD. */
  costMicroUsd: number;
  /** Calls with no known cost (no tokens reported, or no price). */
  unpricedCalls: number;
};

const num = (expr: SQL) => sql<number>`${expr}`.mapWith(Number);

const totals = {
  receipts: num(
    sql`count(distinct ${ocrCalls.receiptId}) filter (where ${ocrCalls.status} = 'ok')`,
  ),
  calls: num(sql`count(*)`),
  failedCalls: num(sql`count(*) filter (where ${ocrCalls.status} <> 'ok')`),
  inputTokens: num(sql`coalesce(sum(${ocrCalls.inputTokens}), 0)::bigint`),
  cachedInputTokens: num(sql`coalesce(sum(${ocrCalls.cachedInputTokens}), 0)::bigint`),
  cacheWriteTokens: num(sql`coalesce(sum(${ocrCalls.cacheWriteTokens}), 0)::bigint`),
  outputTokens: num(sql`coalesce(sum(${ocrCalls.outputTokens}), 0)::bigint`),
  reasoningTokens: num(sql`coalesce(sum(${ocrCalls.reasoningTokens}), 0)::bigint`),
  costMicroUsd: num(sql`coalesce(sum(${ocrCalls.costMicroUsd}), 0)::bigint`),
  unpricedCalls: num(sql`count(*) filter (where ${ocrCalls.costMicroUsd} is null)`),
};

/** Model calls only: rounds that failed before calling a model cost nothing. */
const scoped = (scope: UsageScope, since: Date) =>
  and(
    gte(ocrCalls.createdAt, since),
    isNotNull(ocrCalls.model),
    scope === "all" ? undefined : eq(ocrCalls.organizationId, scope.organizationId),
  );

const DAY = sql<string>`to_char(date_trunc('day', ${ocrCalls.createdAt} at time zone 'UTC'), 'YYYY-MM-DD')`;

/** One row per UTC day that had calls, oldest first. */
export const usageByDay = (scope: UsageScope, since: Date) =>
  Effect.flatMap(Db, ({ use }) =>
    use((db): Promise<(UsageTotals & { day: string })[]> =>
      db
        .select({ day: DAY, ...totals })
        .from(ocrCalls)
        .where(scoped(scope, since))
        .groupBy(sql`1`)
        .orderBy(sql`1`),
    ),
  );

export type ModelUsage = UsageTotals & {
  model: string;
  provider: string;
  /** Successful calls that were a fallback (not the chain's first step). */
  fallbackCalls: number;
  /** Latency of successful calls; null without any. */
  p50Ms: number | null;
  p95Ms: number | null;
};

const percentile = (p: number) =>
  sql<
    number | null
  >`percentile_cont(${p}) within group (order by ${ocrCalls.latencyMs}) filter (where ${ocrCalls.status} = 'ok')`.mapWith(
    (v) => (v == null ? null : Math.round(Number(v))),
  );

/** One row per model, most expensive first. */
export const usageByModel = (scope: UsageScope, since: Date) =>
  Effect.flatMap(Db, ({ use }) =>
    use((db): Promise<ModelUsage[]> =>
      db
        .select({
          // Never null here: `scoped` keeps model calls only.
          model: sql<string>`${ocrCalls.model}`,
          provider: sql<string>`${ocrCalls.provider}`,
          ...totals,
          fallbackCalls: num(
            sql`count(*) filter (where ${ocrCalls.status} = 'ok' and ${ocrCalls.step} > 0)`,
          ),
          p50Ms: percentile(0.5),
          p95Ms: percentile(0.95),
        })
        .from(ocrCalls)
        .where(scoped(scope, since))
        .groupBy(ocrCalls.model, ocrCalls.provider)
        .orderBy(desc(totals.costMicroUsd), ocrCalls.model),
    ),
  );

export type WorkspaceUsage = UsageTotals & {
  /** Null for calls of a deleted workspace, grouped together. */
  organizationId: string | null;
  name: string | null;
};

/** Platform-wide, per workspace, most expensive first. Admin only. */
export const usageByWorkspace = (since: Date, limit = 50) =>
  Effect.flatMap(Db, ({ use }) =>
    use((db): Promise<WorkspaceUsage[]> =>
      db
        .select({ organizationId: ocrCalls.organizationId, name: organization.name, ...totals })
        .from(ocrCalls)
        .leftJoin(organization, eq(organization.id, ocrCalls.organizationId))
        .where(scoped("all", since))
        .groupBy(ocrCalls.organizationId, organization.name)
        .orderBy(desc(totals.costMicroUsd))
        .limit(limit),
    ),
  );

/** Every call made for one receipt of the workspace, in order. */
export const receiptCalls = (receiptId: string, organizationId: string) =>
  Effect.flatMap(Db, ({ use }) =>
    use(async (db) => {
      if (!isReceiptId(receiptId)) return [];
      return db
        .select({
          round: ocrCalls.round,
          jobAttempt: ocrCalls.jobAttempt,
          step: ocrCalls.step,
          model: ocrCalls.model,
          status: ocrCalls.status,
          latencyMs: ocrCalls.latencyMs,
          inputTokens: ocrCalls.inputTokens,
          cachedInputTokens: ocrCalls.cachedInputTokens,
          outputTokens: ocrCalls.outputTokens,
          reasoningTokens: ocrCalls.reasoningTokens,
          costMicroUsd: ocrCalls.costMicroUsd,
          createdAt: ocrCalls.createdAt,
        })
        .from(ocrCalls)
        .where(and(eq(ocrCalls.receiptId, receiptId), eq(ocrCalls.organizationId, organizationId)))
        .orderBy(ocrCalls.round, ocrCalls.jobAttempt, ocrCalls.step);
    }),
  );
