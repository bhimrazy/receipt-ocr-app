import type { Point, Quad } from "@receipt-ocr/vision";

export const CORNER_NAMES = ["Top-left", "Top-right", "Bottom-right", "Bottom-left"] as const;
export const EDGE_NAMES = ["Top", "Right", "Bottom", "Left"] as const;

/*
 * Edge `i` runs from corner i to corner i + 1. Edge maths works in pixel proportions (x scaled
 * by `aspect` = width / height), since normalised units are not square on a non-square image.
 */
const toPx = (p: Point, aspect: number): Point => ({ x: p.x * aspect, y: p.y });
const ends = (quad: Quad, edge: number) => [quad[edge % 4]!, quad[(edge + 1) % 4]!] as const;

/** Unit outward normal of `edge` in pixel proportions (points away from the quad's centroid). */
export function edgeNormal(quad: Quad, edge: number, aspect: number): Point {
  const [a, b] = ends(quad, edge).map((p) => toPx(p, aspect)) as [Point, Point];
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const n = { x: (b.y - a.y) / len, y: -(b.x - a.x) / len };
  const c = toPx(
    { x: quad.reduce((s, p) => s + p.x, 0) / 4, y: quad.reduce((s, p) => s + p.y, 0) / 4 },
    aspect,
  );
  const outward = ((a.x + b.x) / 2 - c.x) * n.x + ((a.y + b.y) / 2 - c.y) * n.y;
  return outward < 0 ? { x: -n.x, y: -n.y } : n;
}

/**
 * Moves edge `edge` (corner edge -> edge + 1) `distance` outward along its normal, measured in
 * pixel proportions (x scaled by `aspect` = width / height), each of its corners sliding along
 * the line to its other neighbour. Angles are unchanged. Assumes a convex quad.
 */
export function slideEdge(quad: Quad, edge: number, distance: number, aspect: number): Quad {
  const n = edgeNormal(quad, edge, aspect);
  const out = [...quad] as Quad;
  // Corner i slides along the side to i - 1; corner i + 1 along the side to i + 2.
  for (const [i, other] of [
    [edge % 4, (edge + 3) % 4],
    [(edge + 1) % 4, (edge + 2) % 4],
  ] as const) {
    const p = toPx(quad[i]!, aspect);
    const o = toPx(quad[other]!, aspect);
    const u = { x: p.x - o.x, y: p.y - o.y };
    const across = u.x * n.x + u.y * n.y;
    if (Math.abs(across) < 1e-12) return quad;
    const t = distance / across;
    out[i] = { x: quad[i]!.x + (u.x * t) / aspect, y: p.y + u.y * t };
  }
  return out;
}

/** Middle of `edge`, normalised. */
export function edgeMidpoint(quad: Quad, edge: number): Point {
  const [a, b] = ends(quad, edge);
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/** Length of `edge` drawn at `width` x `height` pixels. */
export function edgeLength(quad: Quad, edge: number, width: number, height: number): number {
  const [a, b] = ends(quad, edge);
  return Math.hypot((b.x - a.x) * width, (b.y - a.y) * height);
}

/** On-screen angle of `edge` in degrees, clockwise from the x axis (y points down). */
export function edgeAngle(quad: Quad, edge: number, width: number, height: number): number {
  const [a, b] = ends(quad, edge);
  return (Math.atan2((b.y - a.y) * height, (b.x - a.x) * width) * 180) / Math.PI;
}

/**
 * The point of `edge` nearest `p` (all normalised), kept within the middle of the edge:
 * `margin` of its length is left free at each end.
 */
export function nearestOnEdge(
  quad: Quad,
  edge: number,
  p: Point,
  aspect: number,
  margin = 0.1,
): Point {
  const [a, b] = ends(quad, edge);
  const dx = (b.x - a.x) * aspect;
  const dy = b.y - a.y;
  const t = ((p.x - a.x) * aspect * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1);
  const k = Math.min(1 - margin, Math.max(margin, t));
  return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
}
