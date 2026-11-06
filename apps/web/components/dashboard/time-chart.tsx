"use client";

import { ChartContainer, ChartTooltip, type ChartConfig } from "@receipt-ocr/ui/components/chart";
import { useRouter } from "next/navigation";
import {
  Area,
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  ReferenceLine,
  XAxis,
  YAxis,
  type TooltipContentProps,
} from "recharts";
import { change, formatChange, formatValue, niceTicks, type ValueFormat } from "./format";

export type TimePoint = {
  /** Short axis label. */
  label: string;
  /** Tooltip title. */
  title: string;
  value: number | null;
  /** The matching point of the comparison series, if any. */
  previous?: number | null;
  /** Where clicking this point goes (History filtered to it). */
  href?: string;
  /** Drawn fainter: an unfinished bucket such as this month so far. */
  partial?: boolean;
};

export type TimeChartProps = {
  points: TimePoint[];
  format: ValueFormat;
  kind: "area" | "bar" | "line";
  /** Legend and tooltip names; `previous` only when there is a comparison. */
  labels: { value: string; previous?: string };
  reference?: { value: number; label: string };
  height?: number;
};

const config = (labels: TimeChartProps["labels"]): ChartConfig => ({
  value: { label: labels.value, color: "var(--primary)" },
  ...(labels.previous
    ? { previous: { label: labels.previous, color: "var(--muted-foreground)" } }
    : {}),
});

/** One readout for every series at the hovered point, with the change against the comparison. */
function Readout({
  active,
  payload,
  format,
  labels,
}: Partial<TooltipContentProps<number, string>> & {
  format: ValueFormat;
  labels: TimeChartProps["labels"];
}) {
  const point = payload?.[0]?.payload as TimePoint | undefined;
  if (!active || !point) return null;
  const rows = [
    { key: "value", name: labels.value, value: point.value, line: "border-solid border-primary" },
    ...(labels.previous
      ? [
          {
            key: "previous",
            name: labels.previous,
            value: point.previous ?? null,
            line: "border-dashed border-muted-foreground",
          },
        ]
      : []),
  ].filter((r) => r.value != null);
  const delta =
    labels.previous && point.value != null && point.previous != null
      ? change(point.value, point.previous)
      : null;
  return (
    <div className="min-w-40 rounded-lg border border-border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-xl">
      <p className="mb-1.5 font-medium">{point.title}</p>
      {rows.map((r) => (
        <p className="flex items-center justify-between gap-4" key={r.key}>
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <span aria-hidden="true" className={`w-3 border-t-2 ${r.line}`} />
            {r.name}
          </span>
          <span className="font-mono tabular-nums">{formatValue(r.value!, format)}</span>
        </p>
      ))}
      {delta != null ? (
        <p className="mt-1.5 text-muted-foreground">
          <span className="font-mono tabular-nums">{formatChange(delta)}</span> against{" "}
          {labels.previous}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Spend over time: an area or line with an optional dashed comparison, or
 * columns with an optional average line. Hover shows one readout for every
 * series; clicking a point opens History for it. The same numbers are in the
 * card's table, so nothing depends on hovering.
 */
export default function TimeChart({
  points,
  format,
  kind,
  labels,
  reference,
  height = 220,
}: TimeChartProps) {
  const router = useRouter();
  const hasPrevious = Boolean(labels.previous);
  const max = Math.max(
    0,
    reference?.value ?? 0,
    ...points.flatMap((p) => [p.value ?? 0, hasPrevious ? (p.previous ?? 0) : 0]),
  );
  const ticks = niceTicks(max);
  const axis = (v: number) => formatValue(v, format, { compact: true });

  return (
    <div>
      {hasPrevious ? (
        <ul className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <li className="flex items-center gap-1.5">
            <span aria-hidden="true" className="h-0.5 w-4 rounded-full bg-primary" />
            {labels.value}
          </li>
          <li className="flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className="w-4 border-t-2 border-dashed border-muted-foreground"
            />
            {labels.previous}
          </li>
        </ul>
      ) : null}
      <ChartContainer
        aria-hidden="true"
        className="aspect-auto font-mono tabular-nums"
        config={config(labels)}
        style={{ height }}
      >
        <ComposedChart
          accessibilityLayer={false}
          data={points}
          margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
          onClick={(state) => {
            const index = Number(state?.activeTooltipIndex);
            const href = Number.isInteger(index) ? points[index]?.href : undefined;
            if (href) router.push(href);
          }}
          style={{ cursor: points.some((p) => p.href) ? "pointer" : undefined }}
        >
          <CartesianGrid vertical={false} />
          <XAxis
            axisLine={false}
            dataKey="label"
            interval="preserveStartEnd"
            minTickGap={16}
            tickLine={false}
            tickMargin={8}
          />
          <YAxis
            axisLine={false}
            domain={[0, ticks.at(-1)!]}
            tickFormatter={axis}
            tickLine={false}
            ticks={ticks}
            width={56}
          />
          <ChartTooltip
            content={<Readout format={format} labels={labels} />}
            cursor={kind === "bar" ? true : { strokeWidth: 1 }}
          />
          {reference ? (
            <ReferenceLine
              ifOverflow="extendDomain"
              label={{
                value: reference.label,
                position: "insideTopLeft",
                className: "fill-muted-foreground font-sans",
              }}
              stroke="var(--muted-foreground)"
              strokeDasharray="4 4"
              y={reference.value}
            />
          ) : null}
          {hasPrevious ? (
            <Line
              activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--card)" }}
              dataKey="previous"
              dot={false}
              isAnimationActive={false}
              stroke="var(--color-previous)"
              strokeDasharray="4 4"
              strokeWidth={2}
              type="monotone"
            />
          ) : null}
          {kind === "bar" ? (
            <Bar
              dataKey="value"
              fill="var(--color-value)"
              isAnimationActive={false}
              maxBarSize={24}
              radius={[4, 4, 0, 0]}
            >
              {points.map((p, i) => (
                <Cell fillOpacity={p.partial ? 0.45 : 1} key={i} />
              ))}
            </Bar>
          ) : kind === "area" ? (
            <Area
              activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--card)" }}
              dataKey="value"
              fill="var(--color-value)"
              fillOpacity={0.1}
              isAnimationActive={false}
              stroke="var(--color-value)"
              strokeWidth={2}
              type="monotone"
            />
          ) : (
            <Line
              activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--card)" }}
              connectNulls={false}
              dataKey="value"
              dot={false}
              isAnimationActive={false}
              stroke="var(--color-value)"
              strokeWidth={2}
              type="monotone"
            />
          )}
        </ComposedChart>
      </ChartContainer>
    </div>
  );
}
