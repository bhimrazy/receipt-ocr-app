"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { TimeChartProps } from "./time-chart";

// Recharts loads in its own chunk, and only once a chart nears the viewport.
const TimeChart = dynamic(() => import("./time-chart"), { ssr: false });
const Sparkline = dynamic(() => import("./sparkline"), { ssr: false });

function WhenVisible({ height, children }: { height: number; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "200px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  // The box keeps its height before and after, so nothing moves when the chart arrives.
  return (
    <div ref={ref} style={{ minHeight: height }}>
      {visible ? children : null}
    </div>
  );
}

export function LazyTimeChart(props: TimeChartProps) {
  const height = (props.height ?? 220) + (props.labels.previous ? 24 : 0);
  return (
    <WhenVisible height={height}>
      <TimeChart {...props} />
    </WhenVisible>
  );
}

export function LazySparkline({ values }: { values: number[] }) {
  return (
    <WhenVisible height={32}>
      <Sparkline values={values} />
    </WhenVisible>
  );
}
