/**
 * Chart colours, as CSS custom properties set on each chart's root. The app
 * is dark-only, so these are the dark steps of the reference categorical
 * palette, validated on the card surface (#141416): every adjacent pair clears
 * the colour-blind and normal-vision floors, and all reach 3:1 on the surface.
 * Text never uses these; it keeps the foreground tokens.
 */
export const SERIES = [
  "#3987e5", // blue
  "#d95926", // orange
  "#199e70", // aqua
  "#c98500", // yellow
  "#d55181", // magenta
  "#008300", // green
  "#9085e9", // violet
  "#e66767", // red
] as const;

/**
 * Outcome colours for the volume stack, in stack order (read, in flight,
 * failed), so the closest pair (aqua and red) never touch. Legend, labels and
 * the table carry identity too.
 */
export const OUTCOME = { ok: "#199e70", inFlight: "#3987e5", failed: "#e66767" } as const;

/** Past eight series a chart folds the rest into "Other" in this neutral. */
export const OTHER = "#7a7a83";

export const seriesColor = (slot: number) =>
  slot >= 0 && slot < SERIES.length ? SERIES[slot]! : OTHER;
