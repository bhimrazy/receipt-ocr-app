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
