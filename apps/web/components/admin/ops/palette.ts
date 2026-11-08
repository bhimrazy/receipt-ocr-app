/**
 * Chart colours as CSS variables from packages/ui/src/styles.css (`--series-*`), so each theme
 * uses its own validated steps of the reference categorical palette. Text never uses these; it
 * keeps the foreground tokens.
 */
export const SERIES = [
  "var(--series-1)", // blue
  "var(--series-2)", // orange
  "var(--series-3)", // aqua
  "var(--series-4)", // yellow
  "var(--series-5)", // magenta
  "var(--series-6)", // green
  "var(--series-7)", // violet
  "var(--series-8)", // red
] as const;

/**
 * Outcome colours for the volume stack, in stack order (read, in flight,
 * failed), so the closest pair (aqua and red) never touch. Legend, labels and
 * the table carry identity too.
 */
export const OUTCOME = {
  ok: "var(--series-3)",
  inFlight: "var(--series-1)",
  failed: "var(--series-8)",
} as const;

/** Past eight series a chart folds the rest into "Other" in this neutral. */
export const OTHER = "var(--series-other)";

export const seriesColor = (slot: number) =>
  slot >= 0 && slot < SERIES.length ? SERIES[slot]! : OTHER;
