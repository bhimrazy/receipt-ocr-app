import { describe, expect, it } from "vitest";
import { clipLoupe } from "./loupe";

describe("clipLoupe", () => {
  it("keeps a window fully inside the canvas whole", () => {
    expect(clipLoupe(50, 50, 20, 100, 100, 200)).toEqual({
      sx: 40,
      sy: 40,
      sw: 20,
      sh: 20,
      dx: 0,
      dy: 0,
      dw: 200,
      dh: 200,
    });
  });

  it("clips the top-left overhang and moves the destination by the same proportion", () => {
    // Window spans -5..15 on both axes: a quarter lies outside.
    expect(clipLoupe(5, 5, 20, 100, 100, 200)).toEqual({
      sx: 0,
      sy: 0,
      sw: 15,
      sh: 15,
      dx: 50,
      dy: 50,
      dw: 150,
      dh: 150,
    });
  });

  it("clips the bottom-right overhang without shifting the destination origin", () => {
    const r = clipLoupe(95, 98, 20, 100, 100, 200)!;
    expect(r).toMatchObject({ sx: 85, sy: 88, sw: 15, sh: 12, dx: 0, dy: 0, dw: 150, dh: 120 });
  });

  it("returns null when the window misses the canvas", () => {
    expect(clipLoupe(-30, 50, 20, 100, 100, 200)).toBeNull();
  });
});
