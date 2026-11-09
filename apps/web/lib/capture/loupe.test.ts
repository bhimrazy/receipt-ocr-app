import { describe, expect, it } from "vitest";
import { clipLoupe, LOUPE, loupePlacement, loupePosition } from "./loupe";

describe("loupePlacement", () => {
  const width = 390;
  // The loupe fits above a point at y >= 40 + 104 + 4.
  const fitsAt = 148;

  it("starts above when it fits, else beside, away from the nearer side", () => {
    expect(loupePlacement(100, fitsAt, width, null)).toBe("above");
    expect(loupePlacement(100, fitsAt - 1, width, null)).toBe("right");
    expect(loupePlacement(300, 20, width, null)).toBe("left");
  });

  it("goes back above only with 20 px to spare", () => {
    expect(loupePlacement(100, fitsAt + 10, width, "right")).toBe("right");
    expect(loupePlacement(100, fitsAt + 20, width, "right")).toBe("above");
    expect(loupePlacement(100, fitsAt - 1, width, "above")).toBe("right");
  });

  it("keeps its side across the middle, and switches only when it would leave the stage", () => {
    expect(loupePlacement(width / 2 + 30, 20, width, "right")).toBe("right");
    expect(loupePlacement(width - 100, 20, width, "right")).toBe("left");
    expect(loupePlacement(100, 20, width, "left")).toBe("right");
    expect(loupePlacement(150, 20, width, "left")).toBe("left");
  });

  it("does not flip on a stage too narrow for either side", () => {
    expect(loupePlacement(100, 20, 200, "right")).toBe("right");
  });
});

describe("loupePosition", () => {
  const stage = { width: 390, height: 300 };

  it("sits above, centred on the point", () => {
    expect(loupePosition(200, 200, "above", stage)).toEqual({ left: 200 - LOUPE / 2, top: 56 });
  });

  it("sits beside the point and stays inside the stage", () => {
    expect(loupePosition(100, 20, "right", stage)).toEqual({ left: 140, top: 4 });
    expect(loupePosition(300, 290, "left", stage)).toEqual({ left: 156, top: 300 - LOUPE - 4 });
    expect(loupePosition(380, 200, "above", stage).left).toBe(390 - LOUPE - 4);
  });
});

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
