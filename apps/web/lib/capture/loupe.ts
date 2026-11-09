export type LoupeRects = {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
  dx: number;
  dy: number;
  dw: number;
  dh: number;
};

/**
 * The part of a square source window (`span` wide, centred on cx, cy) that lies inside a
 * `width` × `height` canvas, with the matching part of a `size` × `size` destination. WebKit
 * misdraws a `drawImage` whose source rect leaves the canvas, so the caller draws only this.
 * Null when the window misses the canvas entirely.
 */
export function clipLoupe(
  cx: number,
  cy: number,
  span: number,
  width: number,
  height: number,
  size: number,
): LoupeRects | null {
  const left = cx - span / 2;
  const top = cy - span / 2;
  const sx = Math.max(0, left);
  const sy = Math.max(0, top);
  const sw = Math.min(width, left + span) - sx;
  const sh = Math.min(height, top + span) - sy;
  if (sw <= 0 || sh <= 0) return null;
  const k = size / span;
  return { sx, sy, sw, sh, dx: (sx - left) * k, dy: (sy - top) * k, dw: sw * k, dh: sh * k };
}

/** Where the loupe sits relative to the point it magnifies. */
export type LoupePlacement = "above" | "left" | "right";

/** Loupe diameter, its gap to the point, the margin it keeps inside the stage, and the hysteresis. */
export const LOUPE = 104;
const GAP = 40;
const MARGIN = 4;
const HYSTERESIS = 20;

/**
 * Picks the loupe's side for the point (x, y) in a stage `width` wide. Above the finger where
 * it fits, else beside it, away from the nearer stage edge. With a `previous` placement (the
 * same drag) it keeps it until the loupe would leave the stage, and goes back above only once
 * there is `HYSTERESIS` px to spare, so it does not flip back and forth.
 */
export function loupePlacement(
  x: number,
  y: number,
  width: number,
  previous: LoupePlacement | null,
): LoupePlacement {
  const roomAbove = y - GAP - LOUPE - MARGIN;
  const fitsRight = x + GAP + LOUPE <= width - MARGIN;
  const fitsLeft = x - GAP - LOUPE >= MARGIN;
  if (previous === null || previous === "above") {
    if (roomAbove >= 0) return "above";
    return x < width / 2 ? "right" : "left";
  }
  if (roomAbove >= HYSTERESIS) return "above";
  if (previous === "right" && !fitsRight && fitsLeft) return "left";
  if (previous === "left" && !fitsLeft && fitsRight) return "right";
  return previous;
}

/** Top-left of the loupe for the point (x, y) and `placement`, kept inside the stage. */
export function loupePosition(
  x: number,
  y: number,
  placement: LoupePlacement,
  stage: { width: number; height: number },
): { left: number; top: number } {
  const left =
    placement === "above" ? x - LOUPE / 2 : placement === "right" ? x + GAP : x - GAP - LOUPE;
  const top = placement === "above" ? y - GAP - LOUPE : y - LOUPE / 2;
  const clamp = (n: number, max: number) => Math.min(Math.max(MARGIN, n), Math.max(MARGIN, max));
  return {
    left: clamp(left, stage.width - LOUPE - MARGIN),
    top: clamp(top, stage.height - LOUPE - MARGIN),
  };
}
