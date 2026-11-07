import { operationsOverview, OPS_RANGES, type OpsOverview } from "@receipt-ocr/core";
import type { Metadata } from "next";
import Link from "next/link";
import { cache } from "react";
import { z } from "zod";
import { Meter } from "@/components/admin/meter";
import {
  CostChart,
  DataTable,
  KindBars,
  LatencyChart,
  VolumeChart,
  type CostDatum,
  type Series,
} from "@/components/admin/ops/charts";
import { AutoRefresh } from "@/components/admin/ops/auto-refresh";
import {
  bucketTitle,
  formatCount,
  formatDelta,
  formatMs,
  formatPercent,
  formatUsd,
  kindLabel,
  modelLabel,
  modelSlot,
} from "@/components/admin/ops/format";
import { OTHER, SERIES, seriesColor } from "@/components/admin/ops/palette";
import { QueueAlarms, QueuePanel } from "@/components/admin/ops/queue-panel";
import { RangeSwitcher } from "@/components/admin/ops/range-switcher";
import { TelemetryLinks } from "@/components/admin/ops/telemetry-links";
import { AdminPageHeader, AdminSection } from "@/components/admin/page-header";
import { Stat } from "@/components/admin/stat";
import { runtime } from "@/lib/runtime";
import { requireAdmin } from "@/lib/session";
import type { SearchParams } from "../params";

export const metadata: Metadata = { title: "Operations" };

const paramsSchema = z.object({
  range: z.enum(OPS_RANGES).catch("24h"),
  compare: z
    .enum(["1"])
    .optional()
    .catch(undefined)
    .transform((v) => v === "1"),
});

/** One load per request, shared by everything on the page. */
const load = cache((range: (typeof OPS_RANGES)[number], compare: boolean) =>
  runtime.runPromise(operationsOverview(range, { compare })),
);

/** Optional spend guard for the month, in USD; shown only when set. */
function monthlyBudgetMicroUsd(): number | null {
  const value = Number(process.env.OCR_MONTHLY_BUDGET_USD);
  return Number.isFinite(value) && value > 0 ? Math.round(value * 1_000_000) : null;
}

const RANGE_TEXT = {
  "24h": "last 24 hours, by hour",
  "7d": "last 7 days, by day",
  "30d": "last 30 days, by day",
};
const linkClass =
  "rounded-sm text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring";

/** At most eight model series; the rest fold into "Other". */
function modelSeries(models: string[]): { series: Series[]; keyOf: (model: string) => string } {
  const ordered = [...models].sort((a, b) => modelSlot(a, models) - modelSlot(b, models));
  const shown = ordered.slice(
    0,
    ordered.length > SERIES.length ? SERIES.length - 1 : SERIES.length,
  );
  const keys = new Map(shown.map((m, i) => [m, `m${i}`]));
  const series: Series[] = shown.map((m) => ({
    key: keys.get(m)!,
    label: modelLabel(m),
    color: seriesColor(modelSlot(m, models)),
  }));
  if (ordered.length > shown.length)
    series.push({ key: "other", label: "Other models", color: OTHER });
  return { series, keyOf: (m) => keys.get(m) ?? "other" };
}

function Charts({ data, compare }: { data: OpsOverview; compare: boolean }) {
  const prev = data.previous;
  const volume = data.volume.points.map((p, i) => ({
    ...p,
    ...(prev
      ? {
          previous: (() => {
            const q = prev.volume.points[i];
            return q ? q.ok + q.inFlight + q.failed : 0;
          })(),
        }
      : {}),
  }));

  const lat = modelSeries(data.latency.models);
  // "Other" has no single percentile, so latency lines stay per model.
  const latSeries = lat.series.filter((s) => s.key !== "other");
  const latency = data.latency.points.map((p) => ({
    t: p.t,
    ...Object.fromEntries(
      data.latency.models
        .filter((m) => lat.keyOf(m) !== "other")
        .map((m) => [lat.keyOf(m), p.byModel[m]?.p95 ?? null]),
    ),
  }));

  const cost = modelSeries(data.cost.models);
  const costData = data.cost.points.map((p, i) => {
    const row: CostDatum = { t: p.t };
    for (const m of data.cost.models) {
      const key = cost.keyOf(m);
      row[key] = Number(row[key] ?? 0) + (p.byModel[m]?.costMicroUsd ?? 0);
    }
    if (prev) row.previous = prev.cost[i]?.costMicroUsd ?? 0;
    return row;
  });

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <VolumeChart compare={compare} data={volume} />
      <LatencyChart
        data={latency}
        series={latSeries}
        table={
          <DataTable
            caption="Latency per model for the range"
            columns={["Model", "Calls", "p50", "p95"]}
            rows={data.latency.models.map((m) => {
              const s = data.latency.byModel[m]!;
              return [modelLabel(m), formatCount(s.calls), formatMs(s.p50), formatMs(s.p95)];
            })}
          />
        }
      />
      <CostChart
        compare={compare}
        data={costData}
        series={cost.series}
        table={
          <DataTable
            caption="Tokens and cost per model for the range"
            columns={["Model", "Calls", "Input", "Cached", "Output", "Reasoning", "Cost"]}
            rows={[
              ...data.cost.models.map((m) => {
                const s = data.cost.byModel[m]!;
                return [
                  modelLabel(m),
                  formatCount(s.calls),
                  formatCount(s.inputTokens),
                  formatCount(s.cachedInputTokens),
                  formatCount(s.outputTokens),
                  formatCount(s.reasoningTokens),
                  `${formatUsd(s.costMicroUsd)}${s.unpriced ? ` (${s.unpriced} unpriced)` : ""}`,
                ];
              }),
              ...data.cost.points
                .filter((p) => Object.values(p.byModel).some((c) => c.calls > 0))
                .map((p) => [
                  bucketTitle(p.t),
                  formatCount(Object.values(p.byModel).reduce((s, c) => s + c.calls, 0)),
                  "",
                  "",
                  "",
                  "",
                  formatUsd(Object.values(p.byModel).reduce((s, c) => s + c.costMicroUsd, 0)),
                ]),
            ]}
          />
        }
      />
      <div className="grid gap-4">
        <KindBars
          color={SERIES[1]}
          description="Model calls that didn't return a reading. A failed call can still be followed by a successful fallback or retry."
          empty="No failed model calls in this range."
          items={data.failures.calls.map((k) => ({ label: kindLabel(k.kind), count: k.count }))}
          title="Failed calls by kind"
        />
        <KindBars
          color={SERIES[1]}
          description="Jobs that ran out of attempts or failed for good, by their last error."
          empty="No jobs died in this range."
          items={data.failures.deadJobs.map((k) => ({ label: kindLabel(k.kind), count: k.count }))}
          title="Dead jobs by kind"
        />
      </div>
    </div>
  );
}

function bytes(n: number | null) {
  if (n == null) return "–";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}

export default async function AdminOperationsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  await requireAdmin();
  const raw = await searchParams;
  const { range, compare } = paramsSchema.parse({
    range: Array.isArray(raw.range) ? raw.range[0] : raw.range,
    compare: Array.isArray(raw.compare) ? raw.compare[0] : raw.compare,
  });
  const data = await load(range, compare);
  const prev = data.previous;
  const reads = data.volume.totals.ok + data.volume.totals.failed + data.volume.totals.inFlight;
  const prevReads = prev
    ? prev.volume.totals.ok + prev.volume.totals.failed + prev.volume.totals.inFlight
    : null;
  const depth = data.queue.queued + data.queue.running;
  const budget = monthlyBudgetMicroUsd();

  return (
    <>
      <AdminPageHeader
        actions={<AutoRefresh generatedAt={data.generatedAt} />}
        description={`Reads, latency, cost and the job queue across the service, ${RANGE_TEXT[range]} (UTC). Estimated cost is visible to platform admins only.`}
        title="Operations"
      >
        <div className="mt-4">
          <RangeSwitcher compare={compare} range={range} />
        </div>
      </AdminPageHeader>

      <QueueAlarms queue={data.queue} />

      <dl className="sr-only">
        <dt>Range</dt>
        <dd>{RANGE_TEXT[range]}</dd>
      </dl>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Stat
          label="Reads"
          note={
            formatDelta(reads, prevReads) ?? `${formatCount(data.volume.totals.inFlight)} in flight`
          }
          value={reads}
        />
        <Stat
          label="Success rate"
          note={
            prev
              ? `Previous ${formatPercent(prev.volume.successRate)}`
              : `${formatCount(data.volume.totals.failed)} failed`
          }
          tone={
            data.volume.successRate !== null && data.volume.successRate < 0.9
              ? "warning"
              : "default"
          }
          value={formatPercent(data.volume.successRate)}
        />
        <Stat
          label="Latency p95"
          note={
            prev?.latencyP95 != null
              ? `Previous ${formatMs(prev.latencyP95)}`
              : data.latency.overall
                ? `p50 ${formatMs(data.latency.overall.p50)}`
                : "No calls"
          }
          value={formatMs(data.latency.overall?.p95)}
        />
        <Stat
          label="Estimated cost"
          note={
            formatDelta(data.cost.total.costMicroUsd, prev?.costMicroUsd) ??
            `${formatCount(data.cost.total.calls)} model calls`
          }
          value={formatUsd(data.cost.total.costMicroUsd)}
        />
        <Stat
          href="/admin/jobs?state=queued"
          label="Queue depth"
          note={`${formatCount(data.queue.due)} due · ${formatCount(data.queue.running)} running`}
          tone={(data.queue.oldestDueSeconds ?? 0) > 180 ? "warning" : "default"}
          value={depth}
        />
        <Stat
          href="/admin/jobs?state=dead"
          label="Dead jobs, 24 h"
          note={data.queue.dead24h > 0 ? "Open to re-run" : "None"}
          tone={data.queue.dead24h > 0 ? "destructive" : "default"}
          value={data.queue.dead24h}
        />
      </div>

      <div className="mt-6">
        <Charts compare={compare} data={data} />
      </div>

      <AdminSection
        action={
          <Link
            className={`${linkClass} inline-flex min-h-11 items-center text-sm md:min-h-0`}
            href="/admin/jobs"
          >
            Open jobs
          </Link>
        }
        className="mt-10"
        description="Right now, whatever the range."
        id="ops-queue"
        title="Job queue"
      >
        <QueuePanel queue={data.queue} />
      </AdminSection>

      <AdminSection
        className="mt-10"
        description="This calendar month (UTC), projected from the last 7 days of the usage ledger."
        id="ops-usage"
        title="Usage and cost"
      >
        <div className="grid gap-4 lg:grid-cols-[20rem_minmax(0,1fr)]">
          <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
            <dl className="grid grid-cols-2 gap-3">
              <div>
                <dt className="text-xs text-muted-foreground">Month to date</dt>
                <dd className="mt-1 font-mono text-lg font-semibold tabular-nums">
                  {formatUsd(data.month.monthToDateMicroUsd)}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Projected for {data.month.month}</dt>
                <dd className="mt-1 font-mono text-lg font-semibold tabular-nums">
                  {formatUsd(data.month.projectedMicroUsd)}
                </dd>
              </div>
            </dl>
            <p className="text-xs text-muted-foreground">
              {formatUsd(data.month.dailyRunRateMicroUsd)} a day over the last 7 days, for{" "}
              {data.month.daysLeft} more {data.month.daysLeft === 1 ? "day" : "days"}.
              {data.month.unpriced > 0
                ? ` ${formatCount(data.month.unpriced)} calls had no price, so this is a lower bound.`
                : ""}
            </p>
            {budget !== null ? (
              <div className="border-t border-border pt-3">
                <p className="text-xs text-muted-foreground">
                  Projected against the {formatUsd(budget)} monthly budget
                </p>
                <Meter
                  className="mt-2"
                  label="Projected model cost against the monthly budget"
                  limit={Math.round(budget / 10_000)}
                  showNumbers={false}
                  used={Math.round(data.month.projectedMicroUsd / 10_000)}
                />
                <p className="mt-1 font-mono text-xs tabular-nums">
                  {formatPercent(data.month.projectedMicroUsd / budget, 0)} of budget
                </p>
              </div>
            ) : null}
            <div className="border-t border-border pt-3 text-xs text-muted-foreground">
              <p>
                {formatCount(data.people.signups)} sign-ups and {formatCount(data.people.active)}{" "}
                active users in this range.
              </p>
              <details className="mt-1">
                <summary className="inline-flex min-h-11 cursor-pointer items-center rounded-sm outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring md:min-h-0">
                  Show per {data.window.unit}
                </summary>
                <div className="mt-2 max-h-60 overflow-auto rounded-md border border-border">
                  <DataTable
                    caption="Sign-ups and active users"
                    columns={["Time", "Sign-ups", "Active"]}
                    rows={data.people.points.map((p) => [bucketTitle(p.t), p.signups, p.active])}
                  />
                </div>
              </details>
              <p className="mt-1">
                Active means signed in or started a read; impersonation doesn&apos;t count.
              </p>
            </div>
          </div>
          <div className="min-w-0 rounded-lg border border-border bg-card">
            <h3 className="px-4 pt-4 text-sm font-medium">Top workspaces by cost in this range</h3>
            {data.topWorkspaces.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-muted-foreground">
                No model calls in this range.
              </p>
            ) : (
              <div className="mt-2 overflow-x-auto">
                <table className="w-full text-sm">
                  <caption className="sr-only">
                    Top 10 workspaces by estimated cost, then the rest
                  </caption>
                  <thead>
                    <tr className="border-b border-border text-xs text-muted-foreground">
                      <th className="px-4 py-2 text-left font-medium" scope="col">
                        Workspace
                      </th>
                      <th className="px-4 py-2 text-right font-medium" scope="col">
                        Reads
                      </th>
                      <th className="px-4 py-2 text-right font-medium" scope="col">
                        Calls
                      </th>
                      <th className="px-4 py-2 text-right font-medium" scope="col">
                        Cost
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.topWorkspaces.map((w) => (
                      <tr
                        className="border-b border-border/60 last:border-0"
                        key={w.other ? "other" : (w.organizationId ?? "deleted")}
                      >
                        <th
                          className="max-w-48 truncate px-4 py-2 text-left font-normal"
                          scope="row"
                        >
                          {w.other ? (
                            <span className="text-muted-foreground">
                              {formatCount(w.workspaces)} other workspaces
                            </span>
                          ) : w.organizationId && w.name ? (
                            <Link
                              className={linkClass}
                              href={`/admin/workspaces/${w.organizationId}`}
                            >
                              {w.name}
                            </Link>
                          ) : (
                            <span className="text-muted-foreground">Deleted workspace</span>
                          )}
                        </th>
                        <td className="px-4 py-2 text-right font-mono tabular-nums">
                          {formatCount(w.reads)}
                        </td>
                        <td className="px-4 py-2 text-right font-mono tabular-nums">
                          {formatCount(w.calls)}
                        </td>
                        <td className="px-4 py-2 text-right font-mono tabular-nums">
                          {formatUsd(w.costMicroUsd)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </AdminSection>

      <AdminSection
        className="mt-10"
        description="Postgres sizes the app's database role can read. Object storage size isn't shown: R2 reports it only in its dashboard."
        id="ops-storage"
        title="Storage"
      >
        <div className="rounded-lg border border-border bg-card p-4 text-sm">
          <p>
            Database:{" "}
            <span className="font-mono tabular-nums">{bytes(data.storage.databaseBytes)}</span>
          </p>
          {data.storage.tables.length > 0 ? (
            <p className="mt-1 text-xs text-muted-foreground">
              {data.storage.tables.map((t) => `${t.name} ${bytes(t.bytes)}`).join(" · ")}
            </p>
          ) : null}
        </div>
      </AdminSection>

      <AdminSection
        className="mt-10"
        description="Request-level signals live in the telemetry tools, not in Postgres."
        id="ops-telemetry"
        title="Telemetry"
      >
        <TelemetryLinks />
      </AdminSection>
    </>
  );
}
