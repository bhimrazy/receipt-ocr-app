"use client";

import { ChartContainer } from "@receipt-ocr/ui/components/chart";
import { Line, LineChart, YAxis } from "recharts";

const config = { value: { label: "Trend", color: "var(--primary)" } };

/** A decorative trend line for a stat tile; the tile states the number. */
export default function Sparkline({ values }: { values: number[] }) {
  const data = values.map((value) => ({ value }));
  return (
    <ChartContainer
      aria-hidden="true"
      className="aspect-auto"
      config={config}
      style={{ height: 32 }}
    >
      <LineChart
        accessibilityLayer={false}
        data={data}
        margin={{ top: 2, bottom: 2, left: 0, right: 0 }}
      >
        <YAxis domain={[0, "dataMax"]} hide />
        <Line
          dataKey="value"
          dot={false}
          isAnimationActive={false}
          stroke="var(--color-value)"
          strokeWidth={1.5}
          type="monotone"
        />
      </LineChart>
    </ChartContainer>
  );
}
