"use client";

import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@receipt-ocr/ui/components/chart";
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
      <ChartContainer aria-hidden="true" config={config(labels)} style={{ height }}>
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
            content={
              <ChartTooltipContent
                footer={(payload) => {
                  const point = payload[0]?.payload as TimePoint | undefined;
                  if (!hasPrevious || point?.value == null || point.previous == null) return null;
                  const delta = change(point.value, point.previous);
                  return delta == null ? null : `${formatChange(delta)} against ${labels.previous}`;
                }}
                formatValue={(v) => formatValue(v, format)}
                title={(payload) => (payload[0]?.payload as TimePoint | undefined)?.title}
              />
            }
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
