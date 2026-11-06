import { describe, expect, it } from "vitest";
import {
  arrowDelta,
  editKey,
  FULL_QUAD,
  initialEdit,
  isDetected,
  isFullFrame,
  moveCorner,
  nudgeCorner,
  resetToDetected,
  rotateClockwise,
  rotatedSize,
  fullImage,
} from "./edit-state";
import type { Quad } from "./geometry";

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
