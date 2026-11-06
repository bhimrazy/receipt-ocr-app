"use client";

import * as React from "react";
import * as Recharts from "recharts";
import type { TooltipContentProps } from "recharts";
import { cn } from "@receipt-ocr/ui/lib/utils";

/**
 * shadcn-style chart shell over Recharts. Each config key becomes a CSS
 * variable (`--color-<key>`) on the container, so series use
 * `var(--color-<key>)` and colours stay theme tokens.
 */
export type ChartConfig = Record<string, { label: React.ReactNode; color: string }>;

const ChartContext = React.createContext<{ config: ChartConfig } | null>(null);

function useChart() {
  const context = React.useContext(ChartContext);
  if (!context) throw new Error("useChart must be used within a <ChartContainer />");
  return context;
}

function ChartContainer({
  config,
  className,
  style,
  children,
  ...props
}: Omit<React.ComponentProps<"div">, "children"> & {
  config: ChartConfig;
  children: React.ComponentProps<typeof Recharts.ResponsiveContainer>["children"];
}) {
  const vars = Object.fromEntries(
    Object.entries(config).map(([key, item]) => [`--color-${key}`, item.color]),
  ) as React.CSSProperties;
  return (
    <ChartContext.Provider value={{ config }}>
      <div
        data-slot="chart"
        className={cn(
          "flex w-full justify-center font-mono text-2xs tabular-nums",
          "[&_.recharts-cartesian-axis-tick_text]:fill-muted-foreground",
          "[&_.recharts-cartesian-grid_line]:stroke-hairline",
          "[&_.recharts-curve.recharts-tooltip-cursor]:stroke-muted-foreground",
          "[&_.recharts-rectangle.recharts-tooltip-cursor]:fill-wash",
          "[&_.recharts-surface]:outline-none",
          className,
        )}
        style={{ ...vars, ...style }}
        {...props}
      >
        <Recharts.ResponsiveContainer>{children}</Recharts.ResponsiveContainer>
      </div>
    </ChartContext.Provider>
  );
}

const ChartTooltip = Recharts.Tooltip;

type TooltipItem = NonNullable<TooltipContentProps<number, string>["payload"]>[number];

/**
 * The hover readout: a title, one row per series with its key from the
 * config, and an optional footer (for example the change against the
 * previous period). Values are formatted by the caller.
 */
function ChartTooltipContent({
  active,
  payload,
  title,
  formatValue,
  footer,
}: Partial<TooltipContentProps<number, string>> & {
  title?: (payload: readonly TooltipItem[]) => React.ReactNode;
  formatValue: (value: number, key: string) => React.ReactNode;
  footer?: (payload: readonly TooltipItem[]) => React.ReactNode;
}) {
  const { config } = useChart();
  if (!active || !payload?.length) return null;
  const rows = payload.filter((item) => item.value != null && config[String(item.dataKey)]);
  return (
    <div className="min-w-36 rounded-md border border-border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-lg">
      {title ? <div className="mb-1.5 font-sans font-medium">{title(payload)}</div> : null}
      <div className="flex flex-col gap-1">
        {rows.map((item) => {
          const key = String(item.dataKey);
          return (
            <div className="flex items-center justify-between gap-4" key={key}>
              <span className="flex items-center gap-1.5 font-sans text-muted-foreground">
                <span
                  aria-hidden="true"
                  className="h-0.5 w-3 rounded-full"
                  style={{ background: `var(--color-${key})` }}
                />
                {config[key]!.label}
              </span>
              <span className="font-mono tabular-nums">{formatValue(Number(item.value), key)}</span>
            </div>
          );
        })}
      </div>
      {footer ? (
        <div className="mt-1.5 font-sans text-muted-foreground">{footer(payload)}</div>
      ) : null}
    </div>
  );
}

export { ChartContainer, ChartTooltip, ChartTooltipContent, useChart };
