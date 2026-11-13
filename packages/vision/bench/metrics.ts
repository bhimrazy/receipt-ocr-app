import type { Detection } from "../src/detect/detect-quad";
import type { Quad } from "../src/geometry";
import { HEIGHT, MASK_HEIGHT, MASK_WIDTH, WIDTH, type Truth } from "./scene";

export type Outcome = "good" | "loose" | "miss" | "harmful";

export type SceneResult = {
  outcome: Outcome;
  /** Against the paper mask; null when there is no quad or the scene is not a paper photo. */
  iou: number | null;
  /** Largest corner distance as a share of the frame diagonal; only for good scenes with all corners in frame. */
  cornerError: number | null;
  level: Detection["level"];
};

/** A crop that keeps all print and overlaps the paper at least this much is good. */
export const GOOD_IOU = 0.85;
/** Share of print a crop may cut before it counts as harmful. */
export const MAX_PRINT_CUT = 0.005;
/** Share of the image a crop of a screenshot may cut before it counts as harmful. */
export const MAX_DIGITAL_CUT = 0.02;

/** Which detector-size pixels lie inside the quad (centres tested, any winding). */
function rasterise(quad: Quad): Uint8Array {
  const inside = new Uint8Array(MASK_WIDTH * MASK_HEIGHT);
  const pts = quad.map((p) => ({ x: p.x * MASK_WIDTH, y: p.y * MASK_HEIGHT }));
  for (let y = 0; y < MASK_HEIGHT; y++) {
    for (let x = 0; x < MASK_WIDTH; x++) {
      const px = x + 0.5;
      const py = y + 0.5;
      let hit = false;
      for (let i = 0, j = 3; i < 4; j = i++) {
        const a = pts[i]!;
        const b = pts[j]!;
        if (a.y > py !== b.y > py && px < ((b.x - a.x) * (py - a.y)) / (b.y - a.y) + a.x)
          hit = !hit;
      }
      if (hit) inside[y * MASK_WIDTH + x] = 1;
    }
  }
  return inside;
}

/** Largest corner distance in frame-diagonal units, trying each starting corner since the detector may rotate the order. */
export function cornerError(found: Quad, truth: Quad): number {
  const diag = Math.hypot(WIDTH, HEIGHT);
  let best = Infinity;
  for (let shift = 0; shift < 4; shift++) {
    let worst = 0;
    for (let i = 0; i < 4; i++) {
      const a = found[(i + shift) % 4]!;
      const b = truth[i]!;
      worst = Math.max(worst, Math.hypot((a.x - b.x) * WIDTH, (a.y - b.y) * HEIGHT) / diag);
    }
    best = Math.min(best, worst);
  }
  return best;
}

export function scoreScene(truth: Truth, detection: Detection): SceneResult {
  const { quad, level } = detection;
  if (truth.kind === "digital") {
    // Nothing to crop: no quad, or one that keeps (nearly) the whole image, is right.
    if (!quad) return { outcome: "good", iou: null, cornerError: null, level };
    const inside = rasterise(quad);
    let kept = 0;
    for (const v of inside) kept += v;
    const cut = 1 - kept / inside.length;
    return {
      outcome: cut > MAX_DIGITAL_CUT ? "harmful" : "good",
      iou: null,
      cornerError: null,
      level,
    };
  }
  if (!quad) return { outcome: "miss", iou: null, cornerError: null, level };

  const inside = rasterise(quad);
  let print = 0;
  let printCut = 0;
  let inter = 0;
  let union = 0;
  for (let i = 0; i < inside.length; i++) {
    const inQuad = inside[i]!;
    const inPaper = truth.paper[i]!;
    if (truth.print[i]) {
      print++;
      if (!inQuad) printCut++;
    }
    if (inQuad && inPaper) inter++;
    if (inQuad || inPaper) union++;
  }
  const iou = union ? inter / union : 0;
  if (print > 0 && printCut / print > MAX_PRINT_CUT)
    return { outcome: "harmful", iou, cornerError: null, level };
  if (iou < GOOD_IOU) return { outcome: "loose", iou, cornerError: null, level };
  return {
    outcome: "good",
    iou,
    cornerError: truth.cornersInFrame ? cornerError(quad, truth.quad) : null,
    level,
  };
}

export type CategoryStats = {
  n: number;
  good: number;
  loose: number;
  miss: number;
  harmful: number;
  meanIou: number | null;
  cornerMedian: number | null;
  cornerP90: number | null;
};

export const OUTCOMES: Outcome[] = ["good", "loose", "miss", "harmful"];

function quantile(sorted: number[], q: number): number | null {
  if (!sorted.length) return null;
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!;
}

/** Rates are shares of the scenes in 0..1. */
export function summarise(results: SceneResult[]): CategoryStats {
  const n = results.length;
  const count = (o: Outcome) => results.filter((r) => r.outcome === o).length / Math.max(1, n);
  const ious = results.flatMap((r) => (r.iou === null ? [] : [r.iou]));
  const errors = results
    .flatMap((r) => (r.cornerError === null ? [] : [r.cornerError]))
    .sort((a, b) => a - b);
  return {
    n,
    good: count("good"),
    loose: count("loose"),
    miss: count("miss"),
    harmful: count("harmful"),
    meanIou: ious.length ? ious.reduce((s, v) => s + v, 0) / ious.length : null,
    cornerMedian: quantile(errors, 0.5),
    cornerP90: quantile(errors, 0.9),
  };
}

/** Category rates averaged by weight, normalised so the weights need not sum to 100. */
export function weighted(items: { weight: number; stats: CategoryStats }[]) {
  const total = items.reduce((s, i) => s + i.weight, 0) || 1;
  const rate = (o: Outcome) => items.reduce((s, i) => s + i.weight * i.stats[o], 0) / total;
  return { good: rate("good"), loose: rate("loose"), miss: rate("miss"), harmful: rate("harmful") };
}

/** Of the crops the detector would apply, how many cut print; of those it would only suggest, how many were good. */
export function levelAccuracy(results: SceneResult[]) {
  const applied = results.filter((r) => r.level === "apply");
  const suggested = results.filter((r) => r.level === "suggest");
  return {
    applied: applied.length,
    appliedHarmful: applied.filter((r) => r.outcome === "harmful").length,
    suggested: suggested.length,
    suggestedGood: suggested.filter((r) => r.outcome === "good").length,
  };
}

export type CategoryRecord = {
  id: string;
  weight: number;
  /** Hash of every rendered frame and truth in the category, so a changed generator cannot pass as a detector change. */
  fingerprint: string;
  /** One letter per scene: g, l, m or h. */
  outcomes: string;
  /** One letter per scene: a (apply), s (suggest) or n (none). */
  levels: string;
};

const OUTCOME_LETTER: Record<Outcome, string> = { good: "g", loose: "l", miss: "m", harmful: "h" };
const LEVEL_LETTER: Record<Detection["level"], string> = { apply: "a", suggest: "s", none: "n" };
export const encodeOutcomes = (results: SceneResult[]) =>
  results.map((r) => OUTCOME_LETTER[r.outcome]).join("");
export const encodeLevels = (results: SceneResult[]) =>
  results.map((r) => LEVEL_LETTER[r.level]).join("");

/** Categories whose paper is intact and plainly framed, where the corner-error bars apply. */
export const PLAIN_CATEGORIES = ["table", "thermal", "crumpled", "folded", "a4"];
export const MAX_MEDIAN_CORNER_ERROR = 0.007;
export const MAX_P90_CORNER_ERROR = 0.015;

const count = (s: string, c: string) => [...s].filter((x) => x === c).length;

/**
 * The pass bars against a baseline on the same scenes: weighted harmful does not rise, no category gains more than
 * one harmful scene, harmful among applied crops does not rise, weighted good does not fall, no category loses more
 * than two good scenes. Returns the violations. Throws when the two runs cannot be compared (a category missing from
 * the baseline, or a different number of scenes); returns one violation when the scenes themselves differ.
 */
export function compareToBaseline(baseline: CategoryRecord[], current: CategoryRecord[]): string[] {
  const pairs = current.map((now) => {
    const was = baseline.find((b) => b.id === now.id);
    if (!was) throw new Error(`category ${now.id} is not in the baseline`);
    if (was.outcomes.length !== now.outcomes.length) {
      throw new Error(
        `${now.id}: ${now.outcomes.length} scenes against ${was.outcomes.length} in the baseline`,
      );
    }
    return { now, was };
  });
  const changed = pairs.filter(({ now, was }) => now.fingerprint !== was.fingerprint);
  if (changed.length) {
    return [
      `scenes differ from the baseline in ${changed.map((c) => c.now.id).join(", ")}: the generator changed, so rewrite the baseline with --write-baseline --force`,
    ];
  }

  const problems: string[] = [];
  const total = pairs.reduce((s, { now }) => s + now.weight, 0) || 1;
  const rate = (pick: "now" | "was", letter: string) =>
    pairs.reduce(
      (s, pair) =>
        s +
        (pair.now.weight * count(pair[pick].outcomes, letter)) /
          Math.max(1, pair[pick].outcomes.length),
      0,
    ) / total;
  const appliedHarmful = (pick: "now" | "was") =>
    pairs.reduce(
      (s, pair) =>
        s +
        [...pair[pick].outcomes].filter((o, i) => o === "h" && pair[pick].levels[i] === "a").length,
      0,
    );
  const eps = 1e-9;
  if (rate("now", "h") > rate("was", "h") + eps) problems.push("weighted harmful rate rose");
  if (rate("now", "g") < rate("was", "g") - eps) problems.push("weighted good rate fell");
  if (appliedHarmful("now") > appliedHarmful("was")) {
    problems.push("harmful scenes among applied crops rose");
  }
  for (const { now, was } of pairs) {
    if (count(now.outcomes, "h") - count(was.outcomes, "h") > 1) {
      problems.push(`${now.id}: more than one new harmful scene`);
    }
    if (count(was.outcomes, "g") - count(now.outcomes, "g") > 2) {
      problems.push(`${now.id}: lost more than two good scenes`);
    }
  }
  return problems;
}

/** Median and 90th-percentile corner error over the plain categories present in `rows`; empty when within the bars. */
export function cornerBars(rows: { id: string; results: SceneResult[] }[]): string[] {
  const stats = summarise(
    rows.filter((r) => PLAIN_CATEGORIES.includes(r.id)).flatMap((r) => r.results),
  );
  const problems: string[] = [];
  if (stats.cornerMedian !== null && stats.cornerMedian > MAX_MEDIAN_CORNER_ERROR) {
    problems.push(
      `median corner error ${(stats.cornerMedian * 100).toFixed(2)}% on plain categories`,
    );
  }
  if (stats.cornerP90 !== null && stats.cornerP90 > MAX_P90_CORNER_ERROR) {
    problems.push(
      `90th-percentile corner error ${(stats.cornerP90 * 100).toFixed(2)}% on plain categories`,
    );
  }
  return problems;
}
