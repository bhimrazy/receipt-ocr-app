import { quadArea, type Point, type Quad } from "../geometry";

type Component = { size: number; rows: Map<number, [number, number]> };

/** Largest 4-connected component of `mask`, with its leftmost and rightmost pixel per row. */
export function largestComponent(mask: Uint8Array, width: number, height: number) {
  const label = new Int32Array(mask.length).fill(-1);
  const stack = new Int32Array(mask.length);
  let best: { id: number; size: number } = { id: -1, size: 0 };
  let foreground = 0;
  let id = 0;
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || label[start] !== -1) continue;
    let top = 0;
    let size = 0;
    stack[top++] = start;
    label[start] = id;
    while (top > 0) {
      const p = stack[--top]!;
      size++;
      const x = p % width;
      const neighbours = [
        x > 0 ? p - 1 : -1,
        x < width - 1 ? p + 1 : -1,
        p >= width ? p - width : -1,
        p < mask.length - width ? p + width : -1,
      ];
      for (const n of neighbours) {
        if (n >= 0 && mask[n] && label[n] === -1) {
          label[n] = id;
          stack[top++] = n;
        }
      }
    }
    foreground += size;
    if (size > best.size) best = { id, size };
    id++;
  }
  if (best.id < 0) return null;
  const rows = new Map<number, [number, number]>();
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (label[y * width + x] !== best.id) continue;
      const row = rows.get(y);
      if (row) row[1] = x;
      else rows.set(y, [x, x]);
    }
  }
  return { component: { size: best.size, rows } satisfies Component, foreground };
}

/** Andrew's monotone chain; counter-clockwise in screen space is irrelevant, area is absolute. */
export function convexHull(points: Point[]): Point[] {
  const pts = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  if (pts.length < 3) return pts;
  const turn = (o: Point, a: Point, b: Point) =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: Point[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && turn(lower.at(-2)!, lower.at(-1)!, p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: Point[] = [];
  for (const p of pts.reverse()) {
    while (upper.length >= 2 && turn(upper.at(-2)!, upper.at(-1)!, p) <= 0) upper.pop();
    upper.push(p);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

export function polygonArea(points: Point[]) {
  let s = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    s += a.x * b.y - b.x * a.y;
  }
  return Math.abs(s) / 2;
}

/** Puts four corners in top-left, top-right, bottom-right, bottom-left order. */
export function orderCorners(points: Point[]): Quad {
  const cx = points.reduce((s, p) => s + p.x, 0) / points.length;
  const cy = points.reduce((s, p) => s + p.y, 0) / points.length;
  const byAngle = [...points].sort(
    (a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx),
  );
  // Screen y grows down, so increasing atan2 runs clockwise; start at the smallest x + y.
  let first = 0;
  byAngle.forEach((p, i) => {
    if (p.x + p.y < byAngle[first]!.x + byAngle[first]!.y) first = i;
  });
  return [0, 1, 2, 3].map((k) => byAngle[(first + k) % 4]!) as Quad;
}

/** The four hull points spanning the largest quad: start at the diagonal extremes, then refine. */
export function hullCorners(hull: Point[]): Quad | null {
  if (hull.length < 4) return null;
  const pick = (score: (p: Point) => number) =>
    hull.reduce((best, p) => (score(p) > score(best) ? p : best), hull[0]!);
  const corners = [
    pick((p) => -(p.x + p.y)),
    pick((p) => p.x - p.y),
    pick((p) => p.x + p.y),
    pick((p) => p.y - p.x),
  ];
  if (new Set(corners).size < 4) return null;
  const area = (pts: Point[]) => quadArea(orderCorners(pts));
  for (let round = 0; round < 3; round++) {
    let improved = false;
    for (let i = 0; i < 4; i++) {
      let bestArea = area(corners);
      for (const p of hull) {
        if (corners.includes(p)) continue;
        const trial = corners.map((c, j) => (j === i ? p : c));
        const a = area(trial);
        if (a > bestArea + 1e-9) {
          bestArea = a;
          corners[i] = p;
          improved = true;
        }
      }
    }
    if (!improved) break;
  }
  return orderCorners(corners);
}
