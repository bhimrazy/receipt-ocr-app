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
import { FREE_FAILED_ROUNDS, type PlanId, type QuotaScope } from "./plans";
import { isReceiptId } from "./repository";
import { Db } from "./services";

/**
 * Usage counted from the append-only ledger (`ocr_rounds`, `ocr_calls`), never
 * from `receipts`, so deleting a receipt or a workspace gives nothing back.
 *
 * - A round is one upload or one retry, recorded when it is accepted, with the
 *   plan of its workspace at that moment (`ocr_rounds.plan`): the allowance it
 *   draws from.
 * - A plan's `scope` says whose rounds its day and month limits count.
 *   `user` (Free): the user's rounds of that plan across every workspace, so an
 *   extra free workspace adds nothing. `workspace` (Pro): the workspace's
 *   rounds of that plan, whoever uploaded them. A member's Pro scans never use
 *   up their own Free allowance, nor the reverse.
 * - Within a window: receipts read successfully, counted once, plus rounds
 *   still in flight (their job is live, or they are recent with no calls yet),
 *   plus finished failed rounds beyond the first `FREE_FAILED_ROUNDS` of the
 *   window. A few bad photos are free; a stream of them (each one a paid model
 *   call) is not.
 * - The burst limit counts a user's rounds, failed ones included. The plan's
 *   daily pool counts rounds of that plan, platform-wide. The global cap counts
 *   rounds plus model-calling retry attempts: each one costs.
 */

export type UsageCounts = {
  userMinute: number;
  /** Today's and this month's rounds of the plan for its scope (the user or the workspace). */
  day: number;
  /** Null when the plan has no monthly limit. */
  month: number | null;
  /** Rounds of the plan today across every user; null when the plan has no pool. */
  planDay: number | null;
  globalDay: number | null;
};

export type UsageWindow = {
  dayStart: Date;
  minuteStart: Date;
  /** Set when the plan has a monthly limit. */
  monthStart: Date | null;
  /** Rounds younger than this with no calls yet are in flight. */
  pendingSince: Date;
  /** The allowance this round draws from, written to `ocr_rounds.plan`. */
  plan: PlanId;
  /** Whose rounds the day and month count. */
  scope: QuotaScope;
  includePlanPool: boolean;
  includeGlobal: boolean;
};

/** Whose usage is counted: the uploader, and the workspace for pooled plans. */
export type UsageSubject = { userId: string; organizationId: string };

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
 * failed first attempt makes room in the quota. Only an orphaned job (nothing
 * has drained its kind for 5 minutes, or its lease expired 5 minutes ago,
 * see `liveReceiptJob`) stops counting; a job waiting behind a backlog, its
 * owner's cap or a pause keeps holding quota.
 */
const liveJobForRound = sql`exists (select 1 from jobs j where j.receipt_id = r.receipt_id and ${liveReceiptJob("j")} and (j.payload->>'round')::int = r.round)`;
/** The round is over, called a model and none succeeded: paid for, nothing read. */
const failedPaid = sql`(not ${readOk} and not ${liveJobForRound} and exists (select 1 from ocr_calls c where c.receipt_id = r.receipt_id and c.round = r.round and c.model is not null))`;

/**
 * "Used" (see the rules above) for the rounds `which` selects, as a scalar
 * subquery. `pendingSince` null leaves rounds in flight out (admin lists).
 */
const usedSql = (which: SQL, since: Date, pendingSince: Date | null) => {
  const inFlight =
    pendingSince === null
      ? sql`false`
      : sql`(${liveJobForRound} or (r.created_at >= ${ts(pendingSince)} and ${noCalls}))`;
  const mine = sql`${which} and r.created_at >= ${ts(since)}`;
  return sql<number>`((select count(distinct r.receipt_id) from ocr_rounds r where ${mine} and (${readOk} or ${inFlight}))
    + greatest(0, (select count(*) from ocr_rounds r where ${mine} and ${failedPaid}) - ${FREE_FAILED_ROUNDS}))::int`;
};

const NULL_INT = sql`null::int`;

export async function countUsage(
  db: Queryable,
  subject: UsageSubject,
  window: UsageWindow,
): Promise<UsageCounts> {
  const { userId, organizationId } = subject;
  const whose =
    window.scope === "workspace"
      ? sql`r.organization_id = ${organizationId} and r.plan = ${window.plan}`
      : sql`r.user_id = ${userId} and r.plan = ${window.plan}`;
  const rows = await db.execute<{
    user_minute: number;
    day: number;
    month: number | null;
    plan_day: number | null;
    global_day: number | null;
  }>(sql`select
    (select count(*)::int from ocr_rounds r
      where r.user_id = ${userId} and r.created_at >= ${ts(window.minuteStart)}) as user_minute,
    ${usedSql(whose, window.dayStart, window.pendingSince)} as day,
    ${window.monthStart ? usedSql(whose, window.monthStart, window.pendingSince) : NULL_INT} as month,
    ${window.includePlanPool ? planRoundsSince(window.plan, window.dayStart) : NULL_INT} as plan_day,
    ${window.includeGlobal ? roundsSince(window.dayStart) : NULL_INT} as global_day`);
  const row = rows[0];
  const orZero = (value: number | null | undefined, on: boolean) => (on ? (value ?? 0) : null);
  return {
    userMinute: row?.user_minute ?? 0,
    day: row?.day ?? 0,
    month: orZero(row?.month, window.monthStart !== null),
    planDay: orZero(row?.plan_day, window.includePlanPool),
    globalDay: orZero(row?.global_day, window.includeGlobal),
  };
}

/**
 * Serializes one subject's quota check and reservation; released at commit.
 * Always the user, and the workspace too on a workspace-scoped plan, in that
 * order, so two members can't both take a workspace's last scan. The platform-wide pool and
 * the global cap take no lock: concurrent uploads by different users can pass
 * them together, so either can overshoot by at most the number of uploads in
 * flight at that moment.
 */
export async function lockQuota(db: Queryable, subject: UsageSubject, pooled: boolean) {
  await db.execute(
    sql`select pg_advisory_xact_lock(${USER_LOCK_NAMESPACE}, hashtext(${subject.userId}))`,
  );
  if (pooled) {
    await db.execute(
      sql`select pg_advisory_xact_lock(${WORKSPACE_LOCK_NAMESPACE}, hashtext(${subject.organizationId}))`,
    );
  }
}

/** First keys of the two-key advisory locks, so these locks can't collide with others. */
const USER_LOCK_NAMESPACE = 7_301;
const WORKSPACE_LOCK_NAMESPACE = 7_302;

/** Per-user "used today" for admin lists, every plan: the quota's rule without rounds in flight. */
export const receiptsReadSince = (userColumn: SQL, since: Date) =>
  usedSql(sql`r.user_id = ${userColumn}`, since, null);

/** A plan's daily pool: rounds of that plan started since `since`, every user, failed ones included. */
const planRoundsSince = (plan: PlanId, since: Date) =>
  sql<number>`(select count(*) from ocr_rounds r where r.plan = ${plan} and r.created_at >= ${ts(since)})::int`;

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
