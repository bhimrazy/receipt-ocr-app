import { isConvex, type Detection, type Point, type Quad } from "@receipt-ocr/vision";
import { edgeNormal, slideEdge } from "./edges";
import { defaultFilter, type Filter } from "./filters";

/**
 * What the reviewer changed on one image. Corners are normalised (0..1) in the frame of the
 * image as shown, that is after `rotation`, so dragging never has to undo the rotation.
 */
export type Rotation = 0 | 90 | 180 | 270;
export type EditState = {
  rotation: Rotation;
  quad: Quad;
  /** The detected document outline, in the same frame as `quad`, if detection found one. */
  detected: Quad | null;
  /** How sure detection was when the photo opened; fixed for the life of the edit. */
  level: Detection["level"];
  filter: Filter;
};

export const FULL_QUAD: Quad = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
];

/** Arrow-key step, and Shift + arrow. */
export const NUDGE = 0.01;
export const NUDGE_LARGE = 0.05;
/** Corners closer than this (normalised) would collapse the crop. */
const MIN_GAP = 0.04;

/** Starts on the detected outline when there is one (the seam for better detectors later). */
export function initialEdit(
  detected: Quad | null = null,
  filter: Filter = "original",
  level: Detection["level"] = "none",
): EditState {
  return { rotation: 0, quad: detected ?? FULL_QUAD, detected, level, filter };
}

/**
 * The edit a photo starts on, which is also what a photo nobody opens is uploaded with. It is
 * cropped only when detection is sure enough to apply the outline unseen; otherwise it is the
 * full image, with the outline offered through "Reset to detected".
 */
export function editFromDetection(
  detection: Pick<Detection, "quad" | "level">,
  rememberedFilter: Filter | null,
): EditState {
  const apply = detection.level === "apply";
  const edit = initialEdit(detection.quad, defaultFilter(rememberedFilter, apply), detection.level);
  return apply ? edit : fullImage(edit);
}

/** (x, y) in the old frame lands at (1 - y, x) after a quarter turn clockwise. */
const turn = (p: Point): Point => ({ x: 1 - p.y, y: p.x });
/** The old bottom-left becomes the new top-left, so the order rotates by one. */
const turnQuad = (q: Quad): Quad => [turn(q[3]), turn(q[0]), turn(q[1]), turn(q[2])];

export function rotateClockwise(state: EditState): EditState {
  return {
    ...state,
    rotation: ((state.rotation + 90) % 360) as Rotation,
    quad: turnQuad(state.quad),
    detected: state.detected ? turnQuad(state.detected) : null,
  };
}

/** Width and height of the image as shown after `rotation`. */
export function rotatedSize(width: number, height: number, rotation: Rotation) {
  return rotation % 180 === 0 ? { width, height } : { width: height, height: width };
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/**
 * Moves one corner, clamped to the image. A move that would make the crop cross itself,
 * fold or collapse is refused: the state comes back unchanged.
 */
export function moveCorner(state: EditState, index: number, to: Point): EditState {
  const point = { x: clamp01(to.x), y: clamp01(to.y) };
  const quad = state.quad.map((p, i) => (i === index ? point : p)) as Quad;
  const tooClose = quad.some(
    (p, i) => i !== index && Math.hypot(p.x - point.x, p.y - point.y) < MIN_GAP,
  );
  if (tooClose || !isConvex(quad)) return state;
  return { ...state, quad };
}

/** Convex, with no moved corner closer than MIN_GAP to any other. */
function allowed(quad: Quad, moved: readonly number[]): boolean {
  if (!isConvex(quad)) return false;
  return moved.every((i) =>
    quad.every((p, j) => j === i || Math.hypot(p.x - quad[i]!.x, p.y - quad[i]!.y) >= MIN_GAP),
  );
}

/**
 * `at(1)` if it is allowed, else the furthest allowed `at(t)` for t in 0..1, by 12 bisection
 * steps (within 1/4000 of the move). `at(0)` is the start, assumed allowed.
 */
function furthest(at: (t: number) => Quad, moved: readonly number[]): Quad {
  const end = at(1);
  if (allowed(end, moved)) return end;
  let lo = 0;
  let hi = 1;
  for (let step = 0; step < 12; step++) {
    const mid = (lo + hi) / 2;
    if (allowed(at(mid), moved)) lo = mid;
    else hi = mid;
  }
  return at(lo);
}

const withQuad = (state: EditState, quad: Quad) =>
  sameQuad(quad, state.quad) ? state : { ...state, quad };

/**
 * Moves corner `index` of `from` (the quad at drag start) by `delta` (normalised), clamped to
 * the image, and stopped at the last allowed position before the crop would fold or two
 * corners get closer than MIN_GAP. Returns `state` itself when nothing moves.
 */
export function dragCorner(state: EditState, index: number, from: Quad, delta: Point): EditState {
  const start = from[index]!;
  const end = { x: clamp01(start.x + delta.x), y: clamp01(start.y + delta.y) };
  const at = (t: number) =>
    from.map((p, i) =>
      i === index ? { x: start.x + (end.x - start.x) * t, y: start.y + (end.y - start.y) * t } : p,
    ) as Quad;
  return withQuad(state, furthest(at, [index]));
}

export function nudgeCorner(state: EditState, index: number, dx: number, dy: number): EditState {
  return dragCorner(state, index, state.quad, { x: dx, y: dy });
}

/**
 * Moves `edge` of `from` (the quad at drag start) by the part of `delta` (normalised) that runs
 * across it, clamped to the image, and stopped at the last valid position before corners get
 * closer than MIN_GAP. Returns `state` itself when nothing moves.
 */
export function moveEdge(
  state: EditState,
  edge: number,
  from: Quad,
  delta: Point,
  aspect: number,
): EditState {
  const n = edgeNormal(from, edge, aspect);
  let distance = delta.x * aspect * n.x + delta.y * n.y;
  // Each corner moves linearly with the distance, so the image border bounds it to an interval.
  const unit = slideEdge(from, edge, 1, aspect);
  let low = -Infinity;
  let high = Infinity;
  for (const i of [edge % 4, (edge + 1) % 4]) {
    for (const axis of ["x", "y"] as const) {
      const p = from[i]![axis];
      const v = unit[i]![axis] - p;
      if (Math.abs(v) < 1e-12) continue;
      const [a, b] = [-p / v, (1 - p) / v];
      low = Math.max(low, Math.min(a, b));
      high = Math.min(high, Math.max(a, b));
    }
  }
  distance = Math.min(high, Math.max(low, distance));
  const at = (t: number) =>
    slideEdge(from, edge, distance * t, aspect).map((p) => ({
      x: clamp01(p.x),
      y: clamp01(p.y),
    })) as Quad;
  return withQuad(state, furthest(at, [edge % 4, (edge + 1) % 4]));
}

export function nudgeEdge(
  state: EditState,
  edge: number,
  dx: number,
  dy: number,
  aspect: number,
): EditState {
  return moveEdge(state, edge, state.quad, { x: dx, y: dy }, aspect);
}

/** Arrow keys to a nudge; null for any other key. */
export function arrowDelta(key: string, large: boolean): { dx: number; dy: number } | null {
  const step = large ? NUDGE_LARGE : NUDGE;
  switch (key) {
    case "ArrowLeft":
      return { dx: -step, dy: 0 };
    case "ArrowRight":
      return { dx: step, dy: 0 };
    case "ArrowUp":
      return { dx: 0, dy: -step };
    case "ArrowDown":
      return { dx: 0, dy: step };
    default:
      return null;
  }
}

const sameQuad = (a: Quad, b: Quad) =>
  a.every((p, i) => Math.abs(p.x - b[i]!.x) < 1e-6 && Math.abs(p.y - b[i]!.y) < 1e-6);

export const isFullFrame = (quad: Quad) => sameQuad(quad, FULL_QUAD);
export const isDetected = (state: EditState) =>
  state.detected !== null && sameQuad(state.quad, state.detected);

export const fullImage = (state: EditState): EditState => ({ ...state, quad: FULL_QUAD });
export const resetToDetected = (state: EditState): EditState =>
  state.detected ? { ...state, quad: state.detected } : state;

/** Corners in pixels of the shown (rotated) image. */
export function quadToPixels(quad: Quad, width: number, height: number): Quad {
  return quad.map((p) => ({ x: p.x * width, y: p.y * height })) as Quad;
}

/** A stable key for an edit, so an encoded result can be reused while nothing changed. */
export function editKey(state: EditState): string {
  return `${state.rotation}:${state.filter}:${state.quad.map((p) => `${p.x.toFixed(4)},${p.y.toFixed(4)}`).join(";")}`;
}
