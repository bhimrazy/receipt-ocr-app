/**
 * Plane geometry for the crop editor: points, quads and the homography that straightens a
 * quad into a rectangle. Pure functions, no DOM, so they run in tests and in a worker.
 */

export type Point = { x: number; y: number };
/** Corners in order: top-left, top-right, bottom-right, bottom-left. */
export type Quad = [Point, Point, Point, Point];
/** Row-major 3x3 matrix with h[8] = 1. */
export type Homography = number[];

export const CORNER_NAMES = ["Top-left", "Top-right", "Bottom-right", "Bottom-left"] as const;

const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

/** z of (b - a) x (c - b): the turn direction at b. */
function cross(a: Point, b: Point, c: Point) {
  return (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
}

/** Strictly convex with every turn the same way (so no corner crosses another). */
export function isConvex(quad: Quad): boolean {
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const turn = cross(quad[i]!, quad[(i + 1) % 4]!, quad[(i + 2) % 4]!);
    if (Math.abs(turn) < 1e-9) return false;
    const s = Math.sign(turn);
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return true;
}

/** Shoelace area (always positive). */
export function quadArea(quad: Quad): number {
  let sum = 0;
  for (let i = 0; i < 4; i++) {
    const a = quad[i]!;
    const b = quad[(i + 1) % 4]!;
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}

/** Interior angle at each corner, in degrees. */
export function cornerAngles(quad: Quad): number[] {
  return quad.map((p, i) => {
    const prev = quad[(i + 3) % 4]!;
    const next = quad[(i + 1) % 4]!;
    const ax = prev.x - p.x;
    const ay = prev.y - p.y;
    const bx = next.x - p.x;
    const by = next.y - p.y;
    const cos = (ax * bx + ay * by) / (Math.hypot(ax, ay) * Math.hypot(bx, by) || 1);
    return (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI;
  });
}

/**
 * Size of the straightened output: the longer of each pair of opposite edges, scaled down
 * (never up) to fit `maxPixels`.
 */
export function straightenedSize(quad: Quad, maxPixels: number) {
  const [tl, tr, br, bl] = quad;
  let width = Math.max(dist(tl, tr), dist(bl, br));
  let height = Math.max(dist(tl, bl), dist(tr, br));
  const scale = Math.min(1, Math.sqrt(maxPixels / Math.max(1, width * height)));
  width = Math.max(1, Math.round(width * scale));
  height = Math.max(1, Math.round(height * scale));
  return { width, height };
}

/** Solves Ax = b (n x n) by Gaussian elimination with partial pivoting; null if singular. */
function solve(a: number[][], b: number[]): number[] | null {
  const n = b.length;
  const m = a.map((row, i) => [...row, b[i]!]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(m[r]![col]!) > Math.abs(m[pivot]![col]!)) pivot = r;
    }
    if (Math.abs(m[pivot]![col]!) < 1e-12) return null;
    [m[col], m[pivot]] = [m[pivot]!, m[col]!];
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = m[r]![col]! / m[col]![col]!;
      if (f === 0) continue;
      for (let c = col; c <= n; c++) m[r]![c]! -= f * m[col]![c]!;
    }
  }
  return m.map((row, i) => row[n]! / row[i]!);
}

/** The projective transform taking each `from[i]` to `to[i]`; null for degenerate input. */
export function homography(from: Quad, to: Quad): Homography | null {
  // A folded or flat quad has no sensible straightening, even when the system solves.
  if (!isConvex(from) || !isConvex(to)) return null;
  const a: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = from[i]!;
    const { x: u, y: v } = to[i]!;
    a.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    b.push(u);
    a.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    b.push(v);
  }
  const h = solve(a, b);
  return h ? [...h, 1] : null;
}

export function applyHomography(h: Homography, p: Point): Point {
  const w = h[6]! * p.x + h[7]! * p.y + h[8]!;
  return { x: (h[0]! * p.x + h[1]! * p.y + h[2]!) / w, y: (h[3]! * p.x + h[4]! * p.y + h[5]!) / w };
}

export type Pixels = { data: Uint8ClampedArray; width: number; height: number };

/**
 * Straightens `quad` (in `src` pixel coordinates) into a `width` x `height` RGBA image by
 * inverse mapping each output pixel centre into the source with bilinear sampling. Points
 * outside the source read as white, like paper.
 */
export function warpQuad(src: Pixels, quad: Quad, width: number, height: number): Pixels {
  const rect: Quad = [
    { x: 0, y: 0 },
    { x: width, y: 0 },
    { x: width, y: height },
    { x: 0, y: height },
  ];
  const h = homography(rect, quad);
  if (!h) throw new Error("degenerate crop");
  const out = new Uint8ClampedArray(width * height * 4);
  const { data, width: sw, height: sh } = src;
  const [h0, h1, h2, h3, h4, h5, h6, h7, h8] = h as [
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  let o = 0;
  for (let v = 0; v < height; v++) {
    const cy = v + 0.5;
    for (let u = 0; u < width; u++) {
      const cx = u + 0.5;
      const w = h6 * cx + h7 * cy + h8;
      // Source pixel centres sit at integer + 0.5.
      const x = (h0 * cx + h1 * cy + h2) / w - 0.5;
      const y = (h3 * cx + h4 * cy + h5) / w - 0.5;
      const x0 = Math.floor(x);
      const y0 = Math.floor(y);
      if (x0 < -1 || y0 < -1 || x0 >= sw || y0 >= sh) {
        out[o] = out[o + 1] = out[o + 2] = out[o + 3] = 255;
        o += 4;
        continue;
      }
      const fx = x - x0;
      const fy = y - y0;
      const xa = Math.max(0, x0);
      const xb = Math.min(sw - 1, x0 + 1);
      const ya = Math.max(0, y0);
      const yb = Math.min(sh - 1, y0 + 1);
      const i00 = (ya * sw + xa) * 4;
      const i10 = (ya * sw + xb) * 4;
      const i01 = (yb * sw + xa) * 4;
      const i11 = (yb * sw + xb) * 4;
      for (let c = 0; c < 4; c++) {
        const top = data[i00 + c]! + (data[i10 + c]! - data[i00 + c]!) * fx;
        const bottom = data[i01 + c]! + (data[i11 + c]! - data[i01 + c]!) * fx;
        out[o + c] = top + (bottom - top) * fy;
      }
      o += 4;
    }
  }
  return { data: out, width, height };
}
