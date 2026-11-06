import { cornerAngles, isConvex, quadArea, type Pixels, type Point, type Quad } from "./geometry";

/**
 * Finds a receipt's outline in a photo without OpenCV: downscale to ~256 px luma, blur,
 * Otsu threshold (and its inverse, for paper darker than the table), largest connected
 * component, convex hull, then the four hull points that span the largest quad. A few
 * milliseconds at this size, so it runs on the main thread.
 *
 * Returns corners normalised to 0..1, or `quad: null` when the result isn't trustworthy
 * (the caller then crops nothing).
 */
export type Detection = { quad: Quad | null; confidence: number };

export const DETECT_EDGE = 256;
const MIN_COVER = 0.2;
const MAX_COVER = 0.98;
const MIN_ANGLE = 45;
const MAX_ANGLE = 135;
/** Below this the outline is too ragged or too fragmented to trust. */
export const MIN_CONFIDENCE = 0.75;

type Grey = { data: Uint8Array; width: number; height: number };

/** Area-averaged luma at a long edge of at most `edge` px. */
export function toSmallLuma(src: Pixels, edge = DETECT_EDGE): Grey {
  const scale = Math.min(1, edge / Math.max(src.width, src.height));
  const width = Math.max(1, Math.round(src.width * scale));
  const height = Math.max(1, Math.round(src.height * scale));
  const sum = new Float64Array(width * height);
  const count = new Uint32Array(width * height);
  const { data } = src;
  for (let y = 0; y < src.height; y++) {
    const ty = Math.min(height - 1, Math.floor(y * scale)) * width;
    for (let x = 0; x < src.width; x++) {
      const i = (y * src.width + x) * 4;
      const t = ty + Math.min(width - 1, Math.floor(x * scale));
      sum[t]! += 0.299 * data[i]! + 0.587 * data[i + 1]! + 0.114 * data[i + 2]!;
      count[t]! += 1;
    }
  }
  const out = new Uint8Array(width * height);
  for (let i = 0; i < out.length; i++) out[i] = count[i] ? sum[i]! / count[i]! : 0;
  return { data: out, width, height };
}

/** 3x3 box blur, edges clamped. */
function blur({ data, width, height }: Grey): Grey {
  const out = new Uint8Array(data.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let s = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = Math.min(height - 1, Math.max(0, y + dy)) * width;
        for (let dx = -1; dx <= 1; dx++) s += data[yy + Math.min(width - 1, Math.max(0, x + dx))]!;
      }
      out[y * width + x] = s / 9;
    }
  }
  return { data: out, width, height };
}

/** The threshold that best splits the histogram into two classes. */
export function otsu(data: Uint8Array): number {
  const hist = new Float64Array(256);
  for (const v of data) hist[v]! += 1;
  const total = data.length;
  let sumAll = 0;
  for (let i = 0; i < 256; i++) sumAll += i * hist[i]!;
  let sumB = 0;
  let wB = 0;
  let best = 0;
  let threshold = 127;
  for (let t = 0; t < 256; t++) {
    wB += hist[t]!;
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * hist[t]!;
    const mB = sumB / wB;
    const mF = (sumAll - sumB) / wF;
    const between = wB * wF * (mB - mF) ** 2;
    if (between > best) {
      best = between;
      threshold = t;
    }
  }
  return threshold;
}

type Component = { size: number; rows: Map<number, [number, number]> };

/** Largest 4-connected component of `mask`, with its leftmost and rightmost pixel per row. */
function largestComponent(mask: Uint8Array, width: number, height: number) {
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

function polygonArea(points: Point[]) {
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

function candidate(mask: Uint8Array, width: number, height: number): Detection {
  const found = largestComponent(mask, width, height);
  if (!found) return { quad: null, confidence: 0 };
  const { component, foreground } = found;
  const points: Point[] = [];
  let spanArea = 0;
  for (const [y, [x0, x1]] of component.rows) {
    // Pixel edges, not centres, so a component touching the frame reaches 0 and 1.
    points.push({ x: x0, y }, { x: x0, y: y + 1 }, { x: x1 + 1, y }, { x: x1 + 1, y: y + 1 });
    spanArea += x1 + 1 - x0;
  }
  const hull = convexHull(points);
  const corners = hullCorners(hull);
  if (!corners) return { quad: null, confidence: 0 };
  const area = quadArea(corners);
  const cover = area / (width * height);
  const angles = cornerAngles(corners);
  // How much of the outline is filled (holes from text are filled per row), how much of the
  // foreground is this one piece, and how close the hull is to four straight sides.
  const fill = Math.min(1, spanArea / Math.max(1, area));
  const share = component.size / Math.max(1, foreground);
  const squareness = Math.min(1, area / Math.max(1, polygonArea(hull)));
  const confidence = Math.min(fill, squareness, share + 0.25);
  const ok =
    cover >= MIN_COVER &&
    cover <= MAX_COVER &&
    isConvex(corners) &&
    angles.every((a) => a >= MIN_ANGLE && a <= MAX_ANGLE) &&
    confidence >= MIN_CONFIDENCE;
  const quad = corners.map((p) => ({ x: p.x / width, y: p.y / height })) as Quad;
  return { quad: ok ? quad : null, confidence: ok ? confidence : 0 };
}

export function detectQuad(src: Pixels): Detection {
  const small = blur(toSmallLuma(src));
  const t = otsu(small.data);
  const light = new Uint8Array(small.data.length);
  const dark = new Uint8Array(small.data.length);
  for (let i = 0; i < light.length; i++) {
    light[i] = small.data[i]! > t ? 1 : 0;
    dark[i] = 1 - light[i]!;
  }
  const a = candidate(light, small.width, small.height);
  const b = candidate(dark, small.width, small.height);
  return b.confidence > a.confidence ? b : a;
}
