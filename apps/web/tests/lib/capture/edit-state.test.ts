import { isConvex, type Point, type Quad } from "@receipt-ocr/vision";
import { describe, expect, it } from "vitest";
import {
  arrowDelta,
  dragCorner,
  editFromDetection,
  editKey,
  FULL_QUAD,
  initialEdit,
  isDetected,
  isFullFrame,
  moveCorner,
  moveEdge,
  NUDGE,
  nudgeCorner,
  nudgeEdge,
  resetToDetected,
  rotateClockwise,
  rotatedSize,
  fullImage,
} from "@/lib/capture/edit-state";

const detected: Quad = [
  { x: 0.1, y: 0.2 },
  { x: 0.8, y: 0.15 },
  { x: 0.9, y: 0.9 },
  { x: 0.2, y: 0.85 },
];

describe("initial state", () => {
  it("defaults to the whole image when nothing was detected", () => {
    const s = initialEdit();
    expect(s.rotation).toBe(0);
    expect(isFullFrame(s.quad)).toBe(true);
    expect(s.filter).toBe("original");
  });

  it("starts on the detected outline", () => {
    const s = initialEdit(detected, "enhance");
    expect(s.quad).toEqual(detected);
    expect(isDetected(s)).toBe(true);
  });
});

describe("editFromDetection", () => {
  it("crops to a confident outline and defaults to Enhance", () => {
    const s = editFromDetection({ quad: detected, level: "apply" }, null);
    expect(s.quad).toEqual(detected);
    expect(s.filter).toBe("enhance");
  });

  it("starts an unsure outline on the full image, offered through Reset to detected", () => {
    const s = editFromDetection({ quad: detected, level: "suggest" }, null);
    expect(isFullFrame(s.quad)).toBe(true);
    expect(s.filter).toBe("original");
    expect(resetToDetected(s).quad).toEqual(detected);
  });

  it("keeps the session's filter either way", () => {
    expect(editFromDetection({ quad: detected, level: "suggest" }, "bw").filter).toBe("bw");
    expect(editFromDetection({ quad: null, level: "none" }, "bw").filter).toBe("bw");
  });
});

describe("rotation", () => {
  it("cycles through four quarter turns back to the start", () => {
    let s = initialEdit(detected);
    const seen = [];
    for (let i = 0; i < 4; i++) {
      s = rotateClockwise(s);
      seen.push(s.rotation);
    }
    expect(seen).toEqual([90, 180, 270, 0]);
    s.quad.forEach((p, i) => {
      expect(p.x).toBeCloseTo(detected[i]!.x, 9);
      expect(p.y).toBeCloseTo(detected[i]!.y, 9);
    });
  });

  it("keeps the corners on the same paper after a turn, in top-left-first order", () => {
    const s = rotateClockwise(initialEdit(detected));
    // The old bottom-left (0.2, 0.85) is now top-left at (1 - 0.85, 0.2).
    expect(s.quad[0].x).toBeCloseTo(0.15, 9);
    expect(s.quad[0].y).toBeCloseTo(0.2, 9);
    expect(isDetected(s)).toBe(true);
    expect(isFullFrame(rotateClockwise(initialEdit()).quad)).toBe(true);
  });

  it("swaps width and height on quarter turns", () => {
    expect(rotatedSize(400, 300, 90)).toEqual({ width: 300, height: 400 });
    expect(rotatedSize(400, 300, 180)).toEqual({ width: 400, height: 300 });
  });
});

describe("moving corners", () => {
  it("moves a corner and clamps it inside the image", () => {
    const s = moveCorner(initialEdit(), 0, { x: -0.5, y: 0.1 });
    expect(s.quad[0]).toEqual({ x: 0, y: 0.1 });
  });

  it("refuses a move that would cross the crop over itself", () => {
    const s = initialEdit();
    expect(moveCorner(s, 0, { x: 1, y: 1 })).toBe(s);
    expect(moveCorner(s, 0, { x: 0.99, y: 0.99 })).toBe(s);
  });

  it("refuses to collapse two corners together", () => {
    const s = initialEdit();
    expect(moveCorner(s, 0, { x: 0.98, y: 0.01 })).toBe(s);
  });

  it("nudges with arrow keys, larger with Shift", () => {
    expect(arrowDelta("ArrowRight", false)).toEqual({ dx: 0.01, dy: 0 });
    expect(arrowDelta("ArrowUp", true)).toEqual({ dx: 0, dy: -0.05 });
    expect(arrowDelta("Enter", false)).toBeNull();
    const s = nudgeCorner(initialEdit(), 2, -0.05, -0.05);
    expect(s.quad[2].x).toBeCloseTo(0.95, 9);
    expect(s.quad[2].y).toBeCloseTo(0.95, 9);
  });
});

describe("dragging corners", () => {
  it("moves by the drag delta from where the drag started", () => {
    const s = initialEdit(detected);
    const moved = dragCorner(s, 1, detected, { x: -0.1, y: 0.05 });
    expect(moved.quad[1].x).toBeCloseTo(0.7, 9);
    expect(moved.quad[1].y).toBeCloseTo(0.2, 9);
    // Back to no delta is back to the start.
    expect(dragCorner(moved, 1, detected, { x: 0, y: 0 }).quad).toEqual(detected);
  });

  it("stops at the limit instead of refusing the move", () => {
    const s = initialEdit();
    const moved = dragCorner(s, 0, s.quad, { x: 2, y: 2 });
    expect(moved).not.toBe(s);
    expect(isConvex(moved.quad)).toBe(true);
    // It travelled most of the way to the opposite corner, along the diagonal.
    expect(moved.quad[0].x).toBeGreaterThan(0.4);
    expect(moved.quad[0].x).toBeCloseTo(moved.quad[0].y, 9);
  });
});

describe("moving edges", () => {
  const aspect = 3 / 4;
  /** Cross product of two edge directions in pixel proportions: 0 when parallel. */
  const parallel = (a: [Point, Point], b: [Point, Point]) =>
    (a[1].x - a[0].x) * aspect * (b[1].y - b[0].y) - (a[1].y - a[0].y) * (b[1].x - b[0].x) * aspect;

  it("returns the same state when the edge is already on the border", () => {
    const s = initialEdit();
    expect(moveEdge(s, 0, s.quad, { x: 0, y: -0.2 }, aspect)).toBe(s);
  });

  it("stops a tilted edge with its first corner on the border, still parallel", () => {
    const s = initialEdit(detected);
    const moved = moveEdge(s, 0, detected, { x: 0, y: -1 }, aspect);
    const [tl, tr] = moved.quad;
    expect(Math.min(tl.y, tr.y)).toBeCloseTo(0, 9);
    expect(Math.min(tl.y, tr.y)).toBeGreaterThanOrEqual(0);
    expect(parallel([detected[0], detected[1]], [tl, tr])).toBeCloseTo(0, 9);
    expect(moved.quad[2]).toEqual(detected[2]);
    expect(moved.quad[3]).toEqual(detected[3]);
  });

  it("stops at the minimum gap when dragged past the opposite edge", () => {
    const s = initialEdit();
    const moved = moveEdge(s, 0, s.quad, { x: 0, y: 3 }, aspect);
    const q = moved.quad;
    expect(isConvex(q)).toBe(true);
    const gap = Math.hypot(q[0].x - q[3].x, q[0].y - q[3].y);
    expect(gap).toBeGreaterThanOrEqual(0.04);
    expect(gap - 0.04).toBeLessThan(1e-3);
    expect(q[0].y).toBeCloseTo(q[1].y, 9);
  });

  it("ignores movement along the edge", () => {
    const s = initialEdit(detected);
    const along = {
      x: (detected[1].x - detected[0].x) / 2,
      y: (detected[1].y - detected[0].y) / 2,
    };
    expect(moveEdge(s, 0, detected, along, 1)).toBe(s);
  });

  it("does not drift: the same drag gives the same quad", () => {
    const s = initialEdit(detected);
    const delta = { x: 0.03, y: 0.08 };
    const once = moveEdge(s, 3, detected, delta, aspect);
    expect(moveEdge(s, 3, detected, delta, aspect).quad).toEqual(once.quad);
    expect(moveEdge(once, 3, detected, delta, aspect)).toBe(once);
    expect(moveEdge(once, 3, detected, { x: 0, y: 0 }, aspect).quad).toEqual(detected);
  });

  it("keeps edge 0 as the visual top after a turn", () => {
    const turned = rotateClockwise(initialEdit(detected));
    const moved = nudgeEdge(turned, 0, 0, NUDGE, 1 / aspect);
    const [tl, tr, br, bl] = moved.quad;
    expect(tl.y).toBeGreaterThan(turned.quad[0].y);
    expect(tr.y).toBeGreaterThan(turned.quad[1].y);
    expect(br).toEqual(turned.quad[2]);
    expect(bl).toEqual(turned.quad[3]);
    expect(Math.max(tl.y, tr.y)).toBeLessThan(Math.min(br.y, bl.y));
  });

  it("is no longer the detected outline, and changes the key", () => {
    const s = initialEdit(detected);
    const moved = nudgeEdge(s, 1, NUDGE, 0, aspect);
    expect(isDetected(moved)).toBe(false);
    expect(editKey(moved)).not.toBe(editKey(s));
  });

  it("nudges across the edge only", () => {
    const s = initialEdit();
    const down = nudgeEdge(s, 0, 0, NUDGE, aspect);
    expect(down.quad[0].y).toBeCloseTo(NUDGE, 9);
    expect(down.quad[1].y).toBeCloseTo(NUDGE, 9);
    expect(down.quad[0].x).toBeCloseTo(0, 9);
    expect(nudgeEdge(s, 0, -NUDGE, 0, aspect)).toBe(s);
    const left = nudgeEdge(s, 1, -NUDGE, 0, aspect);
    expect(left.quad[1].x).toBeCloseTo(1 - NUDGE, 9);
    expect(left.quad[2].x).toBeCloseTo(1 - NUDGE, 9);
  });
});

describe("reset and keys", () => {
  it("switches between the whole image and the detected outline", () => {
    const s = fullImage(initialEdit(detected));
    expect(s.quad).toEqual(FULL_QUAD);
    expect(resetToDetected(s).quad).toEqual(detected);
    const none = initialEdit();
    expect(resetToDetected(none)).toBe(none);
  });

  it("changes the key when anything that affects the output changes", () => {
    const s = initialEdit();
    const keys = new Set([
      editKey(s),
      editKey(rotateClockwise(s)),
      editKey(nudgeCorner(s, 0, 0.1, 0.1)),
      editKey({ ...s, filter: "bw" }),
    ]);
    expect(keys.size).toBe(4);
    expect(editKey(initialEdit())).toBe(editKey(s));
  });
});
