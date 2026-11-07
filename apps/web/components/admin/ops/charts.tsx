"use client";

import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@receipt-ocr/ui/components/chart";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  LabelList,
  Line,
  LineChart,
  XAxis,
  YAxis,
} from "recharts";
import { bucketLabel, bucketTitle, formatCount, formatMs, formatTick, formatUsd } from "./format";
import { OUTCOME } from "./palette";

/**
 * Thin wrappers over Recharts (through the shared shadcn `ChartContainer`),
 * so the chart library can change in this one file. Each chart is a figure
 * with a legend for two or more series, a few direct labels, a tooltip, and
 * the same numbers in a table under "Show data" for screen readers and
 * anyone who wants exact values. Colours are CSS variables from `palette.ts`.
 */

export type Series = { key: string; label: string; color: string };

// Tick text uses the muted foreground token so it keeps AA contrast on the card (recharts defaults to grey).
const AXIS = {
  tickLine: false,
  axisLine: false,
  fontSize: 11,
  tick: { fill: "var(--muted-foreground)" },
} as const;
const GRID = <CartesianGrid stroke="var(--border)" strokeOpacity={0.6} vertical={false} />;

function Legend({ series, extra }: { series: Series[]; extra?: React.ReactNode }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
      {series.map((s) => (
        <li className="flex items-center gap-1.5" key={s.key}>
          <span
            aria-hidden="true"
            className="size-2.5 shrink-0 rounded-sm"
            style={{ background: s.color }}
          />
          {s.label}
        </li>
      ))}
      {extra}
    </ul>
  );
}

const PreviousKey = () => (
  <li className="flex items-center gap-1.5">
    <span aria-hidden="true" className="w-4 border-t-2 border-dashed border-muted-foreground" />
    Previous period
  </li>
);

export function ChartFrame({
  title,
  description,
  legend,
  table,
  empty,
  children,
}: {
  title: string;
  description?: React.ReactNode;
  legend?: React.ReactNode;
  table: React.ReactNode;
  /** Shown instead of the plot when there is nothing to draw. */
  empty?: string | null;
  children: React.ReactNode;
}) {
  return (
    <figure className="flex min-w-0 flex-col gap-3 rounded-lg border border-border bg-card p-4">
      <figcaption className="flex flex-col gap-1">
        <span className="text-sm font-medium text-foreground">{title}</span>
        {description ? <span className="text-xs text-muted-foreground">{description}</span> : null}
      </figcaption>
      {empty ? (
        <p className="flex h-48 items-center justify-center rounded-md border border-dashed border-border px-4 text-center text-sm text-muted-foreground">
          {empty}
        </p>
      ) : (
        <>
          {legend}
          {children}
        </>
      )}
      <details className="group text-xs">
        <summary className="inline-flex min-h-11 cursor-pointer items-center rounded-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring md:min-h-0">
          Show data
        </summary>
        <div className="mt-2 max-h-72 overflow-auto rounded-md border border-border">{table}</div>
      </details>
    </figure>
  );
}

/** A plain data table: first column the row label, numbers right-aligned in monospace. */
export function DataTable({
  caption,
  columns,
  rows,
}: {
  caption: string;
  columns: string[];
  rows: (string | number)[][];
}) {
  return (
    <table className="w-full border-collapse text-xs">
      <caption className="sr-only">{caption}</caption>
      <thead className="sticky top-0 bg-card">
        <tr>
          {columns.map((c, i) => (
            <th
              className={`border-b border-border px-2 py-1.5 font-medium text-muted-foreground ${i === 0 ? "text-left" : "text-right"}`}
              key={c}
              scope="col"
            >
              {c}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr className="border-b border-border/60 last:border-0" key={String(row[0])}>
            {row.map((cell, i) =>
              i === 0 ? (
                <th
                  className="px-2 py-1 text-left font-normal whitespace-nowrap"
                  key={i}
                  scope="row"
                >
                  {cell}
                </th>
              ) : (
                <td className="px-2 py-1 text-right font-mono tabular-nums" key={i}>
                  {cell}
                </td>
              ),
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const configOf = (series: Series[]): ChartConfig =>
  Object.fromEntries(series.map((s) => [s.key, { label: s.label, color: s.color }]));

/** Label only the last non-empty point of a line: its value, in text ink. */
function endLabel(
  data: Record<string, unknown>[],
  key: string,
  format: (n: number) => string,
  keys: string[] = [key],
) {
  const lastIndex = (k: string) => {
    let at = -1;
    data.forEach((d, i) => {
      if (d[k] != null) at = i;
    });
    return at;
  };
  const last = lastIndex(key);
  // Labels of series that end close together would sit on top of each other:
  // walk them from highest to lowest and push each one down until it clears the one above.
  const ends = keys
    .map((k) => ({ k, v: Number(data[lastIndex(k)]?.[k] ?? Number.NaN) }))
    .filter((e) => Number.isFinite(e.v))
    .sort((a, b) => b.v - a.v);
  const top = ends[0]?.v || 1;
  const shift = new Map<string, number>();
  ends.forEach((e, i) => {
    const prev = ends[i - 1];
    const prevShift = prev ? (shift.get(prev.k) ?? 0) : 0;
    shift.set(e.k, prev && (prev.v - e.v) / top < 0.12 ? prevShift + 12 : 0);
  });
  const nudge = shift.get(key) ?? 0;
  function EndLabel(props: {
    x?: number | string;
    y?: number | string;
    index?: number;
    value?: unknown;
  }) {
    if (props.index !== last || props.value == null) return null;
    return (
      <text
        className="fill-foreground text-2xs"
        dx={6}
        dy={4 + nudge}
        x={Number(props.x)}
        y={Number(props.y)}
      >
        {format(Number(props.value))}
      </text>
    );
  }
  return EndLabel;
}

// ---------- Volume ----------

export type VolumeDatum = {
  t: string;
  ok: number;
  inFlight: number;
  failed: number;
  previous?: number;
};

export function VolumeChart({ data, compare }: { data: VolumeDatum[]; compare: boolean }) {
  const series: Series[] = [
    { key: "ok", label: "Read", color: OUTCOME.ok },
    { key: "inFlight", label: "In flight", color: OUTCOME.inFlight },
    { key: "failed", label: "Failed", color: OUTCOME.failed },
  ];
  const total = data.reduce((s, d) => s + d.ok + d.inFlight + d.failed, 0);
  const peak = data.reduce(
    (best, d, i) =>
      d.ok + d.inFlight + d.failed > best.v ? { i, v: d.ok + d.inFlight + d.failed } : best,
    { i: -1, v: 0 },
  );
  return (
    <ChartFrame
      description="Each upload or retry, by how it ended. Bars stack read, in flight and failed."
      empty={total === 0 ? "No receipts were read in this range." : null}
      legend={<Legend extra={compare ? <PreviousKey /> : null} series={series} />}
      table={
        <DataTable
          caption="Reads by outcome"
          columns={["Time", "Read", "In flight", "Failed", ...(compare ? ["Previous"] : [])]}
          rows={data.map((d) => [
            bucketTitle(d.t),
            d.ok,
            d.inFlight,
            d.failed,
            ...(compare ? [d.previous ?? 0] : []),
          ])}
        />
      }
      title="Reads"
    >
      <ChartContainer className="aspect-auto h-56 w-full" config={configOf(series)}>
        <ComposedChart data={data} margin={{ top: 16, right: 8, left: 0, bottom: 0 }}>
          {GRID}
          <XAxis dataKey="t" minTickGap={24} tickFormatter={bucketLabel} {...AXIS} />
          <YAxis allowDecimals={false} tickFormatter={formatTick} width={40} {...AXIS} />
          <ChartTooltip
            content={
              <ChartTooltipContent
                labelFormatter={(_, p) => bucketTitle(String(p?.[0]?.payload?.t ?? ""))}
              />
            }
            cursor={{ fill: "var(--muted)" }}
          />
          {/* A 2px card-coloured stroke is the gap between stacked segments. */}
          <Bar
            dataKey="ok"
            fill="var(--color-ok)"
            maxBarSize={24}
            stackId="v"
            stroke="var(--card)"
            strokeWidth={2}
          />
          <Bar
            dataKey="inFlight"
            fill="var(--color-inFlight)"
            maxBarSize={24}
            stackId="v"
            stroke="var(--card)"
            strokeWidth={2}
          />
          <Bar
            dataKey="failed"
            fill="var(--color-failed)"
            maxBarSize={24}
            radius={[4, 4, 0, 0]}
            stackId="v"
            stroke="var(--card)"
            strokeWidth={2}
          >
            <LabelList
              content={(props) =>
                props.index === peak.i ? (
                  <text
                    className="fill-foreground text-2xs"
                    textAnchor="middle"
                    x={Number(props.x) + Number(props.width) / 2}
                    y={Number(props.y) - 4}
                  >
                    {formatCount(peak.v)}
                  </text>
                ) : null
              }
            />
          </Bar>
          {compare ? (
            <Line
              dataKey="previous"
              dot={false}
              isAnimationActive={false}
              name="Previous period"
              stroke="var(--muted-foreground)"
              strokeDasharray="4 4"
              strokeWidth={2}
              type="monotone"
            />
          ) : null}
        </ComposedChart>
      </ChartContainer>
    </ChartFrame>
  );
}

// ---------- Latency ----------

export type LatencyDatum = { t: string } & Record<string, number | string | null>;

export function LatencyChart({
  data,
  series,
  table,
}: {
  data: LatencyDatum[];
  series: Series[];
  table: React.ReactNode;
}) {
  return (
    <ChartFrame
      description="95th percentile per model call, failures included. Gaps mean the model made no calls."
      empty={series.length === 0 ? "No model calls in this range." : null}
      legend={series.length > 1 ? <Legend series={series} /> : null}
      table={table}
      title="Latency, p95 per model"
    >
      <ChartContainer className="aspect-auto h-56 w-full" config={configOf(series)}>
        <LineChart data={data} margin={{ top: 12, right: 56, left: 0, bottom: 0 }}>
          {GRID}
          <XAxis dataKey="t" minTickGap={24} tickFormatter={bucketLabel} {...AXIS} />
          <YAxis tickFormatter={(v: number) => formatMs(v)} width={52} {...AXIS} />
          <ChartTooltip
            content={
              <ChartTooltipContent
                formatter={(value, name) => (
                  <span className="flex w-full justify-between gap-3">
                    <span className="text-muted-foreground">
                      {series.find((s) => s.key === name)?.label ?? String(name)}
                    </span>
                    <span className="font-mono tabular-nums">{formatMs(Number(value))}</span>
                  </span>
                )}
                labelFormatter={(_, p) => bucketTitle(String(p?.[0]?.payload?.t ?? ""))}
              />
            }
          />
          {series.map((s) => (
            <Line
              connectNulls={false}
              dataKey={s.key}
              dot={{ r: 4, strokeWidth: 2, stroke: "var(--card)", fill: `var(--color-${s.key})` }}
              isAnimationActive={false}
              key={s.key}
              stroke={`var(--color-${s.key})`}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              type="monotone"
            >
              {series.length <= 4 ? (
                <LabelList
                  content={endLabel(
                    data,
                    s.key,
                    formatMs,
                    series.map((x) => x.key),
                  )}
                />
              ) : null}
            </Line>
          ))}
        </LineChart>
      </ChartContainer>
    </ChartFrame>
  );
}

// ---------- Cost ----------

export type CostDatum = { t: string; previous?: number } & Record<
  string,
  number | string | undefined
>;

export function CostChart({
  data,
  series,
  compare,
  table,
}: {
  data: CostDatum[];
  series: Series[];
  compare: boolean;
  table: React.ReactNode;
}) {
  const totals = data.map((d) => series.reduce((s, x) => s + Number(d[x.key] ?? 0), 0));
  const peak = totals.reduce((best, v, i) => (v > best.v ? { i, v } : best), { i: -1, v: 0 });
  const top = series.at(-1)?.key;
  return (
    <ChartFrame
      description="Estimated model cost, priced when each call was made. Stacked by model."
      empty={series.length === 0 ? "No model calls in this range." : null}
      legend={
        series.length > 1 || compare ? (
          <Legend extra={compare ? <PreviousKey /> : null} series={series} />
        ) : null
      }
      table={table}
      title="Cost per model"
    >
      <ChartContainer className="aspect-auto h-56 w-full" config={configOf(series)}>
        <ComposedChart data={data} margin={{ top: 16, right: 8, left: 0, bottom: 0 }}>
          {GRID}
          <XAxis dataKey="t" minTickGap={24} tickFormatter={bucketLabel} {...AXIS} />
          <YAxis tickFormatter={(v: number) => formatUsd(v)} width={60} {...AXIS} />
          <ChartTooltip
            content={
              <ChartTooltipContent
                formatter={(value, name) => (
                  <span className="flex w-full justify-between gap-3">
                    <span className="text-muted-foreground">
                      {name === "previous"
                        ? "Previous period"
                        : (series.find((s) => s.key === name)?.label ?? String(name))}
                    </span>
                    <span className="font-mono tabular-nums">{formatUsd(Number(value))}</span>
                  </span>
                )}
                labelFormatter={(_, p) => bucketTitle(String(p?.[0]?.payload?.t ?? ""))}
              />
            }
            cursor={{ fill: "var(--muted)" }}
          />
          {series.map((s) => (
            <Bar
              dataKey={s.key}
              fill={`var(--color-${s.key})`}
              key={s.key}
              maxBarSize={24}
              radius={s.key === top ? [4, 4, 0, 0] : 0}
              stackId="c"
              stroke="var(--card)"
              strokeWidth={2}
            >
              {s.key === top ? (
                <LabelList
                  content={(props) =>
                    props.index === peak.i && peak.v > 0 ? (
                      <text
                        className="fill-foreground text-2xs"
                        textAnchor="middle"
                        x={Number(props.x) + Number(props.width) / 2}
                        y={Number(props.y) - 4}
                      >
                        {formatUsd(peak.v)}
                      </text>
                    ) : null
                  }
                />
              ) : null}
            </Bar>
          ))}
          {compare ? (
            <Line
              dataKey="previous"
              dot={false}
              isAnimationActive={false}
              stroke="var(--muted-foreground)"
              strokeDasharray="4 4"
              strokeWidth={2}
              type="monotone"
            />
          ) : null}
        </ComposedChart>
      </ChartContainer>
    </ChartFrame>
  );
}

// ---------- Horizontal bars (failure kinds) ----------

export function KindBars({
  title,
  description,
  items,
  color,
  empty,
}: {
  title: string;
  description: string;
  items: { label: string; count: number }[];
  color: string;
  empty: string;
}) {
  const series: Series[] = [{ key: "count", label: title, color }];
  return (
    <ChartFrame
      description={description}
      empty={items.length === 0 ? empty : null}
      table={
        <DataTable
          caption={title}
          columns={["Kind", "Count"]}
          rows={items.map((i) => [i.label, i.count])}
        />
      }
      title={title}
    >
      <ChartContainer
        className="aspect-auto w-full"
        config={configOf(series)}
        style={{ height: Math.max(96, items.length * 32 + 16) }}
      >
        <BarChart data={items} layout="vertical" margin={{ top: 0, right: 48, left: 0, bottom: 0 }}>
          <XAxis hide type="number" />
          <YAxis dataKey="label" type="category" width={128} {...AXIS} />
          <ChartTooltip
            content={<ChartTooltipContent hideLabel />}
            cursor={{ fill: "var(--muted)" }}
          />
          <Bar barSize={18} dataKey="count" fill="var(--color-count)" radius={[0, 4, 4, 0]}>
            <LabelList
              className="fill-foreground"
              dataKey="count"
              fontSize={11}
              formatter={(v: unknown) => formatCount(Number(v))}
              position="right"
            />
          </Bar>
        </BarChart>
      </ChartContainer>
    </ChartFrame>
  );
}
