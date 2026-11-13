import { cornerAngles, isConvex, quadArea, type Pixels, type Point, type Quad } from "../geometry";
import { blur, otsu, toSmallLuma, type Grey } from "./channels";
import { convexHull, hullCorners, largestComponent, polygonArea } from "./outline";

/**
 * Finds a receipt's outline in a photo without OpenCV: downscale to ~256 px luma, blur,
 * Otsu threshold (and its inverse, for paper darker than the table), largest connected
 * component, convex hull, then the four hull points that span the largest quad. A few
 * milliseconds at this size, so it runs on the main thread.
 *
 * `quad` is the outline, corners normalised to 0..1, or null when nothing is trustworthy.
 * `level` says what a caller may do with it:
 * - `apply`: crop to it, even on a photo nobody reviews.
 * - `suggest`: offer it, but start on the full image (a wrong crop cuts off print).
 * - `none`: no outline.
 */
export type Detection = {
  quad: Quad | null;
  confidence: number;
  level: "apply" | "suggest" | "none";
};

// A 1:5 receipt standing 61% of a 3:4 frame's height covers 10%.
const MIN_COVER = 0.1;
const MAX_COVER = 0.98;
const MIN_ANGLE = 45;
const MAX_ANGLE = 135;
/** Below this the outline is too ragged or too fragmented to trust. */
export const MIN_CONFIDENCE = 0.75;

/*
 * Applying a crop nobody reviews needs evidence that it holds the whole paper. Each rule
 * targets a way the largest-blob detector cuts print:
 * - The blob is darker than its surroundings: a phone, a card reader, a dark block inside
 *   a page. Receipts are light paper.
 * - The blob is small (under 20% of the frame): a light card or screen is as likely.
 * - The blob touches the frame: a wall, a door, screenshot chrome, or paper that runs on.
 * - Part of the blob lies outside the quad: fingers, a second paper, a cut-off corner.
 * - Other foreground of the same tone rivals the blob: it may be the wrong object, or a
 *   dark band across the paper split off part of it.
 * - One side's edge is much weaker than the others, or an edge carries on past a corner:
 *   a shadow or glare boundary across the paper rather than paper against table.
 */
const APPLY_MIN_COVER = 0.2;
/**
 * Furthest the blob may reach outside the quad, in detection pixels (about 2% of the long
 * edge). Blur and the pixel staircase put a clean tilted sheet up to ~3.5 px out.
 */
const APPLY_MAX_OUTSIDE = 5;
const APPLY_MIN_SHARE = 0.97;
/** The weakest side's luma step, absolute (0..255) and against the strongest side's. */
const APPLY_MIN_STEP = 24;
const APPLY_MIN_SIDE_RATIO = 0.6;
/**
 * A side's line continued past either corner may step by at most this share of the side's
 * own step (or APPLY_MIN_STEP). Wood grain beside a clean sheet reaches ~0.25; a shadow cast
 * across paper and table carries on at 0.4 and up.
 */
const APPLY_MAX_RUN_ON = 0.3;

const NONE: Detection = { quad: null, confidence: 0, level: "none" };

/** How far `p` lies outside `q` (clockwise on screen); 0 when inside. */
function outsideBy(q: Quad, p: Point) {
  let worst = 0;
  for (let i = 0; i < 4; i++) {
    const a = q[i]!;
    const b = q[(i + 1) % 4]!;
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    worst = Math.max(worst, ((b.y - a.y) * (p.x - a.x) - (b.x - a.x) * (p.y - a.y)) / len);
  }
  return worst;
}

/**
 * Mean luma `gap` px on the quad's inner side of the line through side `i` of `q`, minus
 * `gap` px on its outer side, for `t` from `t0` to `t1` along it (0 and 1 are its corners).
 * NaN with fewer than `min` samples in the frame.
 */
function lineStep(grey: Grey, q: Quad, i: number, t0: number, t1: number, min = 1, gap = 3) {
  const a = q[i]!;
  const b = q[(i + 1) % 4]!;
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  // Clockwise on screen, so (dy, -dx) points out of the quad.
  const nx = (b.y - a.y) / len;
  const ny = -(b.x - a.x) / len;
  const at = (x: number, y: number) => {
    const xi = Math.round(x);
    const yi = Math.round(y);
    if (xi < 0 || yi < 0 || xi >= grey.width || yi >= grey.height) return null;
    return grey.data[yi * grey.width + xi]!;
  };
  let sum = 0;
  let n = 0;
  for (let t = t0; t <= t1; t += 1 / len) {
    const x = a.x + (b.x - a.x) * t;
    const y = a.y + (b.y - a.y) * t;
    const inside = at(x - nx * gap, y - ny * gap);
    const outside = at(x + nx * gap, y + ny * gap);
    if (inside === null || outside === null) continue;
    sum += inside - outside;
    n++;
  }
  return n >= min ? sum / n : Number.NaN;
}

/** `polarity` is 1 when the mask holds the lighter class, -1 for the darker. */
function candidate(mask: Uint8Array, grey: Grey, polarity: 1 | -1): Detection {
  const { width, height } = grey;
  const found = largestComponent(mask, width, height);
  if (!found) return NONE;
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
  if (!corners) return NONE;
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
  if (!ok) return NONE;
  const quad = corners.map((p) => ({ x: p.x / width, y: p.y / height })) as Quad;
  const touchesFrame = [...component.rows].some(
    ([y, [x0, x1]]) => x0 === 0 || x1 === width - 1 || y === 0 || y === height - 1,
  );
  const outside = Math.max(...hull.map((p) => outsideBy(corners, p)));
  // Middle 80% of each side: its corners blur both ways.
  const steps = corners.map((_, i) => polarity * lineStep(grey, corners, i, 0.1, 0.9));
  const weakest = Math.min(...steps);
  // The same step carrying on past a corner means the side is a boundary across the paper.
  const runsOn = corners.some((_, i) =>
    [lineStep(grey, corners, i, -0.3, -0.08, 4), lineStep(grey, corners, i, 1.08, 1.3, 4)].some(
      (s) => polarity * s >= Math.max(APPLY_MIN_STEP, APPLY_MAX_RUN_ON * steps[i]!),
    ),
  );
  const apply =
    polarity === 1 &&
    cover >= APPLY_MIN_COVER &&
    !touchesFrame &&
    outside <= APPLY_MAX_OUTSIDE &&
    share >= APPLY_MIN_SHARE &&
    weakest >= APPLY_MIN_STEP &&
    weakest >= APPLY_MIN_SIDE_RATIO * Math.max(...steps) &&
    !runsOn;
  return { quad, confidence, level: apply ? "apply" : "suggest" };
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
  const a = candidate(light, small, 1);
  const b = candidate(dark, small, -1);
  return b.confidence > a.confidence ? b : a;
}
