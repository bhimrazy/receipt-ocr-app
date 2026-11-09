import { sql, type SQL } from "@receipt-ocr/db";
import { Effect } from "effect";
import { liveReceiptJob, STALE_AFTER_MS } from "./jobs/live";
import { JOB_REGISTRY } from "./jobs/registry";
import { Db } from "./services";
import { bucketsBetween, bucketSql, fillBuckets } from "./analytics/time-buckets";
import type { Queryable } from "./usage";

/**
 * Read-only metrics for the admin Operations and Jobs pages. Platform-wide by
 * design: only admin pages call these, behind `requireAdmin`. Each metric is
 * one statement over the ledger (`ocr_rounds`, `ocr_calls`), the queue
 * (`jobs`, `job_controls`) and the auth tables. Time series are bucketed in
 * UTC with `date_trunc` and zero-filled in JS (`analytics/time-buckets.ts`),
 * so a quiet hour shows as 0. Bucket keys are `YYYY-MM-DDTHH` (hours) or
 * `YYYY-MM-DD` (days).
 */

export const OPS_RANGES = ["24h", "7d", "30d"] as const;
export type OpsRange = (typeof OPS_RANGES)[number];

export type OpsWindow = {
  range: OpsRange;
  unit: "hour" | "day";
  /** First bucket start (inclusive). */
  start: Date;
  /** Last bucket end (exclusive). */
  end: Date;
  /** Every bucket key, oldest first. */
  buckets: string[];
};

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
const COUNT: Record<OpsRange, number> = { "24h": 24, "7d": 7, "30d": 30 };

/**
 * 24 h: the last 24 hourly buckets, this hour last. 7 d / 30 d: UTC days,
 * today last. `periodsBack` 1 is the same span just before (for comparison).
 */
export function opsWindow(range: OpsRange, now = new Date(), periodsBack = 0): OpsWindow {
  const unit = range === "24h" ? "hour" : "day";
  const step = unit === "hour" ? HOUR_MS : DAY_MS;
  const span = COUNT[range] * step;
  const end = new Date(Math.floor(now.getTime() / step) * step + step - periodsBack * span);
  const start = new Date(end.getTime() - span);
  return {
    range,
    unit,
    start,
    end,
    buckets: bucketsBetween(start, new Date(end.getTime() - 1), unit),
  };
}

const ts = (date: Date) => sql`${date.toISOString()}::timestamptz`;
const bucketOf = (w: OpsWindow, column: SQL) => bucketSql(column, w.unit, "UTC");
const inWindow = (w: OpsWindow, column: SQL) =>
  sql`${column} >= ${ts(w.start)} and ${column} < ${ts(w.end)}`;

const iso = (value: string | Date) => new Date(value).toISOString();
const num = (value: unknown) => (value == null ? 0 : Number(value));
const numOrNull = (value: unknown) => (value == null ? null : Number(value));

// ---------- Volume ----------

export type VolumePoint = { t: string; ok: number; failed: number; inFlight: number };
export type OpsVolume = {
  points: VolumePoint[];
  totals: { ok: number; failed: number; inFlight: number };
  /** ok / (ok + failed), rounds still in flight left out; null with nothing settled. */
  successRate: number | null;
};

const staleInterval = sql.raw(`interval '${STALE_AFTER_MS / 1000} seconds'`);

/**
 * Rounds (one upload or one user retry) by outcome: read (any call ok), in
 * flight (its job is live, or it is young with no calls yet) or failed.
 */
export async function volumeQuery(db: Queryable, w: OpsWindow): Promise<OpsVolume> {
  const rows = await db
    .execute<{ t: string; ok: number; failed: number; in_flight: number }>(
      sql`
    with r as materialized (
      select r.receipt_id, r.round, r.created_at, ${bucketOf(w, sql`r.created_at`)} as t
      from ocr_rounds r where ${inWindow(w, sql`r.created_at`)}
    ), c as (
      select c.receipt_id, c.round, bool_or(c.status = 'ok') as ok
      from r join ocr_calls c on c.receipt_id = r.receipt_id and c.round = r.round
        -- A call is written after its round starts; this lets the time index narrow the scan.
        and c.created_at >= ${ts(w.start)}
      group by c.receipt_id, c.round
    ), o as materialized (
      select r.t,
        case
          when c.ok then 'ok'
          when exists (select 1 from jobs j where j.receipt_id = r.receipt_id
              and (case when j.payload->>'round' ~ '^[0-9]{1,5}$' then (j.payload->>'round')::int end) = r.round and ${liveReceiptJob("j")})
            or (c.receipt_id is null and r.created_at >= now() - ${staleInterval}) then 'in_flight'
          else 'failed'
        end as outcome
      from r left join c on c.receipt_id = r.receipt_id and c.round = r.round
    )
    select t,
      (count(*) filter (where outcome = 'ok'))::int as ok,
      (count(*) filter (where outcome = 'failed'))::int as failed,
      (count(*) filter (where outcome = 'in_flight'))::int as in_flight
    from o
    group by t`,
    )
    .then((r) => r.rows);
  const points = fillBuckets(
    w.buckets,
    rows.map((r) => ({
      bucket: r.t,
      value: { ok: num(r.ok), failed: num(r.failed), inFlight: num(r.in_flight) },
    })),
    { ok: 0, failed: 0, inFlight: 0 },
  ).map(({ bucket, value }) => ({ t: bucket, ...value }));
  const totals = points.reduce(
    (sum, p) => ({
      ok: sum.ok + p.ok,
      failed: sum.failed + p.failed,
      inFlight: sum.inFlight + p.inFlight,
    }),
    { ok: 0, failed: 0, inFlight: 0 },
  );
  const settled = totals.ok + totals.failed;
  return { points, totals, successRate: settled > 0 ? totals.ok / settled : null };
}

// ---------- Latency ----------

export type LatencyStats = { p50: number; p95: number; calls: number };
export type OpsLatency = {
  models: string[];
  /** One row per bucket; per model, null when it made no calls in that bucket. */
  points: { t: string; byModel: Record<string, LatencyStats | null> }[];
  byModel: Record<string, LatencyStats>;
  overall: LatencyStats | null;
};

/** Per model call, failures included: a timeout is what an operator needs to see. */
export async function latencyQuery(db: Queryable, w: OpsWindow): Promise<OpsLatency> {
  const rows = await db
    .execute<{
      t: string | null;
      model: string | null;
      p50: number;
      p95: number;
      calls: number;
      g: number;
    }>(
      sql`
    select t, model,
      percentile_cont(0.5) within group (order by latency_ms) as p50,
      percentile_cont(0.95) within group (order by latency_ms) as p95,
      count(*)::int as calls,
      grouping(t, model)::int as g
    from (select ${bucketOf(w, sql`c.created_at`)} as t, c.model, c.latency_ms from ocr_calls c
      where ${inWindow(w, sql`c.created_at`)} and c.model is not null) x
    group by grouping sets ((t, model), (model), ())`,
    )
    .then((r) => r.rows);
  const stats = (r: (typeof rows)[number]): LatencyStats => ({
    p50: Math.round(num(r.p50)),
    p95: Math.round(num(r.p95)),
    calls: num(r.calls),
  });
  // grouping(t, model): 0 = (t, model), 2 = (model), 3 = ().
  const cells = rows.filter((r) => r.g === 0);
  const perModel = rows.filter((r) => r.g === 2);
  const total = rows.find((r) => r.g === 3);
  const models = perModel
    .sort((a, b) => num(b.calls) - num(a.calls))
    .map((r) => r.model!)
    .filter(Boolean);
  const grid = new Map(cells.map((r) => [`${r.t}|${r.model}`, stats(r)]));
  return {
    models,
    points: w.buckets.map((t) => ({
      t,
      byModel: Object.fromEntries(models.map((m) => [m, grid.get(`${t}|${m}`) ?? null])),
    })),
    byModel: Object.fromEntries(perModel.map((r) => [r.model!, stats(r)])),
    overall: total && num(total.calls) > 0 ? stats(total) : null,
  };
}

// ---------- Tokens and cost ----------

export type CostStats = {
  calls: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  /** Sum of known costs, micro-USD. */
  costMicroUsd: number;
  /** Calls with no price recorded: the cost is a lower bound when this is above 0. */
  unpriced: number;
};
export type OpsCost = {
  models: string[];
  points: { t: string; byModel: Record<string, CostStats> }[];
  byModel: Record<string, CostStats>;
  total: CostStats;
};

const ZERO_COST: CostStats = {
  calls: 0,
  inputTokens: 0,
  cachedInputTokens: 0,
  outputTokens: 0,
  reasoningTokens: 0,
  costMicroUsd: 0,
  unpriced: 0,
};

export async function costQuery(db: Queryable, w: OpsWindow): Promise<OpsCost> {
  const rows = await db
    .execute<{
      t: string | null;
      model: string | null;
      calls: number;
      input: string | null;
      cached: string | null;
      output: string | null;
      reasoning: string | null;
      cost: string | null;
      unpriced: number;
      g: number;
    }>(
      sql`
    select t, model,
      count(*)::int as calls,
      sum(input_tokens)::bigint as input,
      sum(cached_input_tokens)::bigint as cached,
      sum(output_tokens)::bigint as output,
      sum(reasoning_tokens)::bigint as reasoning,
      sum(cost_micro_usd)::bigint as cost,
      (count(*) filter (where cost_micro_usd is null))::int as unpriced,
      grouping(t, model)::int as g
    from (select ${bucketOf(w, sql`c.created_at`)} as t, c.model, c.input_tokens,
        c.cached_input_tokens, c.output_tokens, c.reasoning_tokens, c.cost_micro_usd
      from ocr_calls c where ${inWindow(w, sql`c.created_at`)} and c.model is not null) x
    group by grouping sets ((t, model), (model), ())`,
    )
    .then((r) => r.rows);
  const stats = (r: (typeof rows)[number]): CostStats => ({
    calls: num(r.calls),
    inputTokens: num(r.input),
    cachedInputTokens: num(r.cached),
    outputTokens: num(r.output),
    reasoningTokens: num(r.reasoning),
    costMicroUsd: num(r.cost),
    unpriced: num(r.unpriced),
  });
  const perModel = rows.filter((r) => r.g === 2);
  const models = perModel
    .sort((a, b) => num(b.cost) - num(a.cost) || num(b.calls) - num(a.calls))
    .map((r) => r.model!)
    .filter(Boolean);
  const grid = new Map(rows.filter((r) => r.g === 0).map((r) => [`${r.t}|${r.model}`, stats(r)]));
  const total = rows.find((r) => r.g === 3);
  return {
    models,
    points: w.buckets.map((t) => ({
      t,
      byModel: Object.fromEntries(models.map((m) => [m, grid.get(`${t}|${m}`) ?? ZERO_COST])),
    })),
    byModel: Object.fromEntries(perModel.map((r) => [r.model!, stats(r)])),
    total: total ? stats(total) : ZERO_COST,
  };
}

// ---------- Top workspaces ----------

export type WorkspaceCost = {
  /** Null for a deleted workspace (its ledger rows stay, unlinked) and for "Other". */
  organizationId: string | null;
  name: string | null;
  /** The row that sums every workspace past the top `limit`. */
  other: boolean;
  workspaces: number;
  calls: number;
  costMicroUsd: number;
  reads: number;
};

/** The top `limit` workspaces by cost, then one "Other" row for the rest (when there is any). */
export async function topWorkspacesQuery(
  db: Queryable,
  w: OpsWindow,
  limit = 10,
): Promise<WorkspaceCost[]> {
  const rows = await db
    .execute<{
      organization_id: string | null;
      name: string | null;
      other: boolean;
      workspaces: number;
      calls: number;
      cost: string | null;
      reads: number;
    }>(
      sql`
    with per as (
      select c.organization_id, count(*)::int as calls,
        coalesce(sum(c.cost_micro_usd), 0)::bigint as cost,
        (count(distinct (c.receipt_id, c.round)) filter (where c.status = 'ok'))::int as reads
      from ocr_calls c
      where ${inWindow(w, sql`c.created_at`)} and c.model is not null
      group by c.organization_id
    ), ranked as (
      select per.*, row_number() over (order by cost desc, calls desc, organization_id) as k from per
    )
    select r.organization_id, o.name, false as other, 1 as workspaces, r.calls, r.cost, r.reads
    from ranked r left join organization o on o.id = r.organization_id where r.k <= ${limit}
    union all
    select null, null, true, count(*)::int, sum(calls)::int, sum(cost)::bigint, sum(reads)::int
    from ranked where k > ${limit} having count(*) > 0
    order by other, cost desc, calls desc`,
    )
    .then((r) => r.rows);
  return rows.map((r) => ({
    organizationId: r.organization_id,
    name: r.name,
    other: r.other,
    workspaces: num(r.workspaces),
    calls: num(r.calls),
    costMicroUsd: num(r.cost),
    reads: num(r.reads),
  }));
}

// ---------- Failures ----------

export type FailureKind = { kind: string; count: number };
export type OpsFailures = {
  /** Model calls that didn't return a reading, by `ocr_calls.status`. */
  calls: FailureKind[];
  /** Jobs that ended dead in the window, by `jobs.last_error_kind`. */
  deadJobs: FailureKind[];
};

export async function failuresQuery(db: Queryable, w: OpsWindow): Promise<OpsFailures> {
  const rows = await db
    .execute<{ source: "call" | "job"; kind: string; n: number }>(
      sql`
    select 'call' as source, c.status as kind, count(*)::int as n from ocr_calls c
    where ${inWindow(w, sql`c.created_at`)} and c.status <> 'ok'
    group by c.status
    union all
    select 'job', coalesce(j.last_error_kind, 'unknown'), count(*)::int from jobs j
    where j.state = 'dead' and ${inWindow(w, sql`j.finished_at`)}
    group by 2
    order by 3 desc, 2`,
    )
    .then((r) => r.rows);
  const of = (source: "call" | "job") =>
    rows.filter((r) => r.source === source).map((r) => ({ kind: r.kind, count: num(r.n) }));
  return { calls: of("call"), deadJobs: of("job") };
}

// ---------- Queue now ----------

export type QueueControl = {
  scope: string;
  paused: boolean;
  until: string | null;
  reason: string | null;
  updatedBy: string | null;
  updatedAt: string;
};
export type OpsQueue = {
  /** The database's clock: ages on the page are relative to this. */
  now: string;
  queued: number;
  /** Queued and runnable now (not waiting out a backoff). */
  due: number;
  /** Queued after a failed attempt, waiting out the backoff. */
  retrying: number;
  running: number;
  /** Running past their lease: the worker died; the next tick reaps them. */
  expiredLeases: number;
  /** Seconds the oldest due job has waited past its `run_at`; null when none is due. */
  oldestDueSeconds: number | null;
  dead24h: number;
  byKind: { kind: string; queued: number; running: number }[];
  /** Pauses and provider cooldowns in force now. */
  controls: QueueControl[];
  /** Last unfiltered tick per kind (`tick:<kind>` rows). */
  ticks: { kind: string; at: string }[];
};

const inForce = sql`(c.paused or c.until is not null) and (c.until is null or c.until > now())`;

/** The queue snapshot as an Effect, for pages that don't hold a database handle. */
export const queueSnapshot = Effect.flatMap(Db, ({ use }) => use((db) => queueQuery(db)));

export async function queueQuery(db: Queryable): Promise<OpsQueue> {
  const [row] = await db
    .execute<{
      now: string;
      queued: number;
      due: number;
      retrying: number;
      running: number;
      expired: number;
      oldest_due_s: number | null;
      dead24h: number;
      by_kind: { kind: string; queued: number; running: number }[] | null;
      controls: QueueControl[] | null;
      ticks: { kind: string; at: string }[] | null;
    }>(
      sql`
    select now() as now,
      (select count(*) from jobs where state = 'queued')::int as queued,
      (select count(*) from jobs where state = 'queued' and run_at <= now())::int as due,
      (select count(*) from jobs where state = 'queued' and attempts > 0)::int as retrying,
      (select count(*) from jobs where state = 'running')::int as running,
      (select count(*) from jobs where state = 'running' and locked_until < now())::int as expired,
      (select extract(epoch from now() - min(run_at))::float8 from jobs
        where state = 'queued' and run_at <= now()) as oldest_due_s,
      (select count(*) from jobs where state = 'dead'
        and finished_at >= now() - interval '24 hours')::int as dead24h,
      (select json_agg(json_build_object('kind', kind, 'queued', queued, 'running', running) order by kind)
        from (select kind, (count(*) filter (where state = 'queued'))::int as queued,
            (count(*) filter (where state = 'running'))::int as running
          from jobs where state in ('queued', 'running') group by kind) k) as by_kind,
      (select json_agg(json_build_object('scope', c.scope, 'paused', c.paused, 'until', c.until,
          'reason', c.reason, 'updatedBy', c.updated_by, 'updatedAt', c.updated_at) order by c.scope)
        from job_controls c where c.scope not like 'tick:%' and ${inForce}) as controls,
      (select json_agg(json_build_object('kind', substr(t.scope, 6), 'at', t.updated_at) order by t.scope)
        from job_controls t where t.scope like 'tick:%') as ticks`,
    )
    .then((r) => r.rows);
  return {
    now: iso(row!.now),
    queued: num(row?.queued),
    due: num(row?.due),
    retrying: num(row?.retrying),
    running: num(row?.running),
    expiredLeases: num(row?.expired),
    oldestDueSeconds: numOrNull(row?.oldest_due_s),
    dead24h: num(row?.dead24h),
    byKind: row?.by_kind ?? [],
    controls: (row?.controls ?? []).map((c) => ({
      ...c,
      until: c.until ? iso(c.until) : null,
      updatedAt: iso(c.updatedAt),
    })),
    ticks: (row?.ticks ?? []).map((t) => ({ kind: t.kind, at: iso(t.at) })),
  };
}

// ---------- Sign-ups and active users ----------

export type OpsPeople = {
  points: { t: string; signups: number; active: number }[];
  signups: number;
  /** Distinct users active anywhere in the window (not the sum of buckets). */
  active: number;
};

/**
 * Active = signed in (a session created or refreshed) or started a read in
 * the bucket. Impersonated sessions don't count. Sessions are deleted when
 * they end, so older buckets lean on uploads more than recent ones.
 */
export async function peopleQuery(db: Queryable, w: OpsWindow): Promise<OpsPeople> {
  const rows = await db
    .execute<{ t: string | null; signups: number; active: number }>(
      sql`
    with x as (
      select ${bucketOf(w, sql`s.created_at`)} as t, s.user_id, false as signup from session s
        where ${inWindow(w, sql`s.created_at`)} and s.impersonated_by is null
      union all
      select ${bucketOf(w, sql`s.updated_at`)}, s.user_id, false from session s
        where ${inWindow(w, sql`s.updated_at`)} and s.impersonated_by is null
      union all
      select ${bucketOf(w, sql`r.created_at`)}, r.user_id, false from ocr_rounds r
        where ${inWindow(w, sql`r.created_at`)} and r.user_id is not null
      union all
      select ${bucketOf(w, sql`u.created_at`)}, u.id, true from "user" u
        where ${inWindow(w, sql`u.created_at`)}
    )
    select t, (count(*) filter (where signup))::int as signups,
      (count(distinct user_id) filter (where not signup))::int as active
    from x group by grouping sets ((t), ())`,
    )
    .then((r) => r.rows);
  const total = rows.find((r) => r.t === null);
  return {
    points: fillBuckets(
      w.buckets,
      rows
        .filter((r) => r.t !== null)
        .map((r) => ({ bucket: r.t!, value: { signups: num(r.signups), active: num(r.active) } })),
      { signups: 0, active: 0 },
    ).map(({ bucket, value }) => ({ t: bucket, ...value })),
    signups: num(total?.signups),
    active: num(total?.active),
  };
}

// ---------- Month projection and storage ----------

export type OpsMonth = {
  /** UTC calendar month, `YYYY-MM`. */
  month: string;
  /** Model cost so far this month, micro-USD, from the ledger (priced when each call was made). */
  monthToDateMicroUsd: number;
  /** Mean daily cost over the last 7 full and partial days. */
  dailyRunRateMicroUsd: number;
  /** Month to date plus the run rate for the days left. */
  projectedMicroUsd: number;
  daysLeft: number;
  /** Calls this month with no price: the figures are a lower bound when above 0. */
  unpriced: number;
};

export async function monthQuery(db: Queryable, now: Date): Promise<OpsMonth> {
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const nextMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  const weekAgo = new Date(now.getTime() - 7 * DAY_MS);
  const [row] = await db
    .execute<{ mtd: string | null; week: string | null; unpriced: number }>(
      sql`
    select
      (sum(cost_micro_usd) filter (where created_at >= ${ts(monthStart)}))::bigint as mtd,
      (sum(cost_micro_usd) filter (where created_at >= ${ts(weekAgo)}))::bigint as week,
      (count(*) filter (where created_at >= ${ts(monthStart)} and cost_micro_usd is null
        and model is not null))::int as unpriced
    from ocr_calls
    where created_at >= ${ts(monthStart < weekAgo ? monthStart : weekAgo)} and created_at <= ${ts(now)}`,
    )
    .then((r) => r.rows);
  const mtd = num(row?.mtd);
  const rate = num(row?.week) / 7;
  const daysLeft = (nextMonth.getTime() - now.getTime()) / DAY_MS;
  return {
    month: monthStart.toISOString().slice(0, 7),
    monthToDateMicroUsd: mtd,
    dailyRunRateMicroUsd: Math.round(rate),
    projectedMicroUsd: Math.round(mtd + rate * daysLeft),
    daysLeft: Math.ceil(daysLeft),
    unpriced: num(row?.unpriced),
  };
}

export type OpsStorage = {
  /** Null when the database role can't read it. */
  databaseBytes: number | null;
  /** Our largest tables, data plus indexes. */
  tables: { name: string; bytes: number }[];
};

const SIZED_TABLES = [
  "ocr_calls",
  "ocr_rounds",
  "jobs",
  "receipts",
  "receipt_items",
  "session",
  "admin_audit_log",
];

/**
 * Sizes that need no extra privilege (any role that can connect may read
 * `pg_database_size` and the size of tables it can see). Object storage size
 * isn't shown: R2 only reports it through a full listing or its dashboard.
 */
export async function storageQuery(db: Queryable): Promise<OpsStorage> {
  try {
    const rows = await db
      .execute<{ name: string | null; bytes: string }>(
        sql`
      select null as name, pg_database_size(current_database())::bigint as bytes
      union all
      select c.relname, pg_total_relation_size(c.oid)::bigint from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = current_schema() and c.relkind = 'r'
        and c.relname in (${sql.join(
          SIZED_TABLES.map((t) => sql`${t}`),
          sql`, `,
        )})`,
      )
      .then((r) => r.rows);
    return {
      databaseBytes: numOrNull(rows.find((r) => r.name === null)?.bytes),
      tables: rows
        .filter((r) => r.name !== null)
        .map((r) => ({ name: r.name!, bytes: num(r.bytes) }))
        .sort((a, b) => b.bytes - a.bytes),
    };
  } catch {
    return { databaseBytes: null, tables: [] };
  }
}

// ---------- The page ----------

/** The same figures for the period just before, for the dashed comparison and deltas. */
export type OpsPrevious = {
  window: OpsWindow;
  volume: OpsVolume;
  latencyP95: number | null;
  /** Cost per bucket, all models, aligned by position with the current window's buckets. */
  cost: { t: string; costMicroUsd: number }[];
  costMicroUsd: number;
};

export type OpsOverview = {
  window: OpsWindow;
  generatedAt: string;
  volume: OpsVolume;
  latency: OpsLatency;
  cost: OpsCost;
  topWorkspaces: WorkspaceCost[];
  failures: OpsFailures;
  queue: OpsQueue;
  people: OpsPeople;
  month: OpsMonth;
  storage: OpsStorage;
  previous: OpsPrevious | null;
};

/**
 * Everything the Operations page shows for `range`. Two statements at a time:
 * the pool is small (5 per process) and the page shares it with live traffic.
 */
export const operationsOverview = (
  range: OpsRange,
  options: { now?: Date; compare?: boolean } = {},
) =>
  Effect.flatMap(Db, ({ use }) => {
    const now = options.now ?? new Date();
    const w = opsWindow(range, now);
    const p = opsWindow(range, now, 1);
    const previous = options.compare
      ? Effect.all(
          {
            volume: use((db) => volumeQuery(db, p)),
            latency: use((db) => latencyQuery(db, p)),
            cost: use((db) => costQuery(db, p)),
          },
          { concurrency: 2 },
        ).pipe(
          Effect.map((parts): OpsPrevious => ({
            window: p,
            volume: parts.volume,
            latencyP95: parts.latency.overall?.p95 ?? null,
            cost: parts.cost.points.map((pt) => ({
              t: pt.t,
              costMicroUsd: Object.values(pt.byModel).reduce((s, c) => s + c.costMicroUsd, 0),
            })),
            costMicroUsd: parts.cost.total.costMicroUsd,
          })),
        )
      : Effect.succeed(null);
    return Effect.all(
      {
        volume: use((db) => volumeQuery(db, w)),
        latency: use((db) => latencyQuery(db, w)),
        cost: use((db) => costQuery(db, w)),
        topWorkspaces: use((db) => topWorkspacesQuery(db, w)),
        failures: use((db) => failuresQuery(db, w)),
        queue: use((db) => queueQuery(db)),
        people: use((db) => peopleQuery(db, w)),
        month: use((db) => monthQuery(db, now)),
        storage: use((db) => storageQuery(db)),
        previous,
      },
      { concurrency: 2 },
    ).pipe(
      Effect.map((parts): OpsOverview => ({ window: w, generatedAt: now.toISOString(), ...parts })),
    );
  });

// ---------- Jobs list and detail ----------

export const JOB_STATES = ["queued", "running", "succeeded", "dead", "cancelled"] as const;
export type JobStateFilter = (typeof JOB_STATES)[number];

/** Kinds a handler runs today; the list filter offers these. */
export const jobKinds = () => Object.keys(JOB_REGISTRY);

export type JobFilters = {
  state?: JobStateFilter;
  kind?: string;
  errorKind?: string;
  /** An exact job, receipt, user or workspace id, or part of a user email or workspace name. */
  q?: string;
};

/** A job as the admin pages show it: ids and metadata only, never payload contents beyond the round. */
export type AdminJobRow = {
  id: string;
  kind: string;
  state: JobStateFilter;
  attempts: number;
  maxAttempts: number;
  round: number | null;
  receiptId: string | null;
  organizationId: string | null;
  workspaceName: string | null;
  userId: string | null;
  userEmail: string | null;
  lastErrorKind: string | null;
  runAt: Date;
  lockedUntil: Date | null;
  createdAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
};

const escapeLike = (value: string) => value.replace(/[\\%_]/g, (c) => `\\${c}`);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const jobWhere = (filters: JobFilters) => {
  const parts: SQL[] = [];
  if (filters.state) parts.push(sql`j.state = ${filters.state}`);
  if (filters.kind) parts.push(sql`j.kind = ${filters.kind}`);
  if (filters.errorKind) parts.push(sql`j.last_error_kind = ${filters.errorKind}`);
  const q = filters.q?.trim();
  if (q) {
    const pattern = `%${escapeLike(q)}%`;
    const byId = UUID.test(q) ? sql`j.id = ${q}::uuid or j.receipt_id = ${q}::uuid or ` : sql``;
    parts.push(sql`(${byId}j.user_id = ${q} or j.organization_id = ${q}
      or u.email ilike ${pattern} or o.name ilike ${pattern})`);
  }
  return parts.length > 0 ? sql`where ${sql.join(parts, sql` and `)}` : sql``;
};

const JOB_ROW = sql.raw(`j.id, j.kind, j.state, j.attempts, j.max_attempts,
  case when j.payload->>'round' ~ '^[0-9]{1,5}$' then (j.payload->>'round')::int end as round,
  j.receipt_id, j.organization_id, o.name as workspace_name, j.user_id, u.email as user_email,
  j.last_error_kind, j.run_at, j.locked_until, j.created_at, j.started_at, j.finished_at`);
const JOB_JOINS = sql.raw(
  `from jobs j left join "user" u on u.id = j.user_id left join organization o on o.id = j.organization_id`,
);

type RawJobRow = {
  id: string;
  kind: string;
  state: JobStateFilter;
  attempts: number;
  max_attempts: number;
  round: number | null;
  receipt_id: string | null;
  organization_id: string | null;
  workspace_name: string | null;
  user_id: string | null;
  user_email: string | null;
  last_error_kind: string | null;
  run_at: string | Date;
  locked_until: string | Date | null;
  created_at: string | Date;
  started_at: string | Date | null;
  finished_at: string | Date | null;
};

const date = (value: string | Date) => new Date(value);
const dateOrNull = (value: string | Date | null) => (value === null ? null : new Date(value));
const toRow = (r: RawJobRow): AdminJobRow => ({
  id: r.id,
  kind: r.kind,
  state: r.state,
  attempts: r.attempts,
  maxAttempts: r.max_attempts,
  round: r.round,
  receiptId: r.receipt_id,
  organizationId: r.organization_id,
  workspaceName: r.workspace_name,
  userId: r.user_id,
  userEmail: r.user_email,
  lastErrorKind: r.last_error_kind,
  runAt: date(r.run_at),
  lockedUntil: dateOrNull(r.locked_until),
  createdAt: date(r.created_at),
  startedAt: dateOrNull(r.started_at),
  finishedAt: dateOrNull(r.finished_at),
});

/** Counts stop here: the list says "10,000+" rather than scanning a large table. */
export const JOB_COUNT_CAP = 10_000;

/**
 * Newest first, offset-paged. `total` is capped at JOB_COUNT_CAP (`capped`
 * true), so an unfiltered page stays an index scan on `jobs_created_at_idx`.
 */
export const listJobs = (filters: JobFilters, page: { page: number; pageSize: number }) =>
  Effect.flatMap(Db, ({ use }) =>
    use(async (db) => {
      const where = jobWhere(filters);
      const offset = (Math.max(1, page.page) - 1) * page.pageSize;
      const rows = await db
        .execute<RawJobRow>(
          sql`
        select ${JOB_ROW} ${JOB_JOINS} ${where}
        order by j.created_at desc, j.id desc
        limit ${page.pageSize} offset ${offset}`,
        )
        .then((r) => r.rows);
      const [count] = await db
        .execute<{ n: number }>(
          sql`select count(*)::int as n from (
          select 1 ${JOB_JOINS} ${where} limit ${JOB_COUNT_CAP + 1}) x`,
        )
        .then((r) => r.rows);
      const n = num(count?.n);
      return {
        rows: rows.map(toRow),
        total: Math.min(n, JOB_COUNT_CAP),
        capped: n > JOB_COUNT_CAP,
      };
    }),
  );

/** Error kinds seen on jobs, for the list filter. */
export const jobErrorKinds = Effect.flatMap(Db, ({ use }) =>
  use(async (db) => {
    const rows = await db
      .execute<{ kind: string }>(
        sql`select distinct last_error_kind as kind from jobs
        where last_error_kind is not null order by 1 limit 50`,
      )
      .then((r) => r.rows);
    return rows.map((r) => r.kind);
  }),
);

export type AttemptLogEntry = {
  n: number;
  at: string;
  outcome: string;
  kind?: string | null;
  worker?: string | null;
  ms?: number | null;
};

export type AdminJobDetail = AdminJobRow & {
  priority: number;
  lockedBy: string | null;
  lastErrorAt: Date | null;
  attemptLog: AttemptLogEntry[];
  /** The receipt's state now (status and current round only), null when it was deleted. */
  receipt: { status: string; attempts: number } | null;
  /** The round's model calls: metadata only. */
  calls: {
    jobAttempt: number;
    step: number;
    model: string | null;
    status: string;
    latencyMs: number;
    inputTokens: number | null;
    outputTokens: number | null;
    costMicroUsd: number | null;
    createdAt: Date;
  }[];
};

export const jobDetail = (id: string) =>
  Effect.flatMap(Db, ({ use }) =>
    use(async (db): Promise<AdminJobDetail | null> => {
      if (!UUID.test(id)) return null;
      const [row] = await db
        .execute<
          RawJobRow & {
            priority: number;
            locked_by: string | null;
            last_error_at: string | Date | null;
            attempt_log: AttemptLogEntry[];
            receipt_status: string | null;
            receipt_attempts: number | null;
          }
        >(
          sql`
        select ${JOB_ROW}, j.priority, j.locked_by, j.last_error_at, j.attempt_log,
          r.status as receipt_status, r.attempts as receipt_attempts
        ${JOB_JOINS} left join receipts r on r.id = j.receipt_id
        where j.id = ${id}::uuid`,
        )
        .then((r) => r.rows);
      if (!row) return null;
      const base = toRow(row);
      const calls =
        base.receiptId && base.round !== null
          ? await db
              .execute<{
                job_attempt: number;
                step: number;
                model: string | null;
                status: string;
                latency_ms: number;
                input_tokens: number | null;
                output_tokens: number | null;
                cost_micro_usd: number | null;
                created_at: string | Date;
              }>(
                sql`
              select job_attempt, step, model, status, latency_ms, input_tokens, output_tokens,
                cost_micro_usd, created_at
              from ocr_calls where receipt_id = ${base.receiptId}::uuid and round = ${base.round}
              order by job_attempt, step`,
              )
              .then((r) => r.rows)
          : [];
      return {
        ...base,
        priority: row.priority,
        lockedBy: row.locked_by,
        lastErrorAt: dateOrNull(row.last_error_at),
        attemptLog: Array.isArray(row.attempt_log) ? row.attempt_log : [],
        receipt:
          row.receipt_status === null
            ? null
            : { status: row.receipt_status, attempts: num(row.receipt_attempts) },
        calls: calls.map((c) => ({
          jobAttempt: c.job_attempt,
          step: c.step,
          model: c.model,
          status: c.status,
          latencyMs: c.latency_ms,
          inputTokens: c.input_tokens,
          outputTokens: c.output_tokens,
          costMicroUsd: c.cost_micro_usd,
          createdAt: date(c.created_at),
        })),
      };
    }),
  );
