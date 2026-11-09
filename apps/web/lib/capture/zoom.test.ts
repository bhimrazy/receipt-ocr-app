import { describe, expect, it } from "vitest";
import {
  actualScale,
  actualView,
  canPan,
  clampView,
  fitScale,
  fitView,
  MAX_ZOOM,
  panBy,
  scaleLimits,
  wheelFactor,
  zoomAt,
  zoomMode,
  zoomPercent,
} from "./zoom";

// The owner's long receipt in a wide desktop stage.
const receipt = { width: 909, height: 2576 };
const desktop = { width: 1000, height: 700 };

describe("fit and actual scale", () => {
  it("fits the long side, and 1:1 is one image pixel per device pixel", () => {
    expect(fitScale(receipt, desktop, 1)).toBeCloseTo(700 / 2576);
    expect(actualScale(1)).toBe(1);
    expect(actualScale(2)).toBe(0.5);
    expect(actualScale(0)).toBe(1);
  });

  it("never enlarges a small image past actual pixels to fit", () => {
    expect(fitScale({ width: 200, height: 100 }, desktop, 1)).toBe(1);
    expect(fitScale({ width: 200, height: 100 }, desktop, 2)).toBe(0.5);
  });

  it("zooms from fitted up to MAX_ZOOM × actual pixels", () => {
    expect(scaleLimits(receipt, desktop, 2)).toEqual({
      min: fitScale(receipt, desktop, 2),
      max: MAX_ZOOM / 2,
    });
  });
});

describe("centring and clamping", () => {
  it("centres the fitted image on both axes", () => {
    const view = fitView(receipt, desktop, 1);
    const shown = receipt.width * view.scale;
    expect(view.x).toBeCloseTo((desktop.width - shown) / 2);
    expect(view.y).toBeCloseTo(0);
  });

  it("centres a narrow image across but opens a tall one at its middle", () => {
    const view = actualView(receipt, desktop, 1);
    expect(view.x).toBeCloseTo((1000 - 909) / 2);
    expect(view.y).toBeCloseTo((700 - 2576) / 2);
  });

  it("keeps the image covering the viewport on an axis where it is larger", () => {
    const view = actualView(receipt, desktop, 1);
    expect(panBy(view, 0, 5000, receipt, desktop, 1).y).toBe(0);
    expect(panBy(view, 0, -5000, receipt, desktop, 1).y).toBe(700 - 2576);
    // Narrower than the viewport: stays centred however far it is dragged.
    expect(panBy(view, 400, 0, receipt, desktop, 1).x).toBeCloseTo(45.5);
  });

  it("clamps the scale to the limits", () => {
    expect(clampView({ scale: 100, x: 0, y: 0 }, receipt, desktop, 1).scale).toBe(MAX_ZOOM);
    expect(clampView({ scale: 0.01, x: 0, y: 0 }, receipt, desktop, 1).scale).toBeCloseTo(
      700 / 2576,
    );
  });
});

describe("zoomAt", () => {
  it("keeps the image point under the pointer in place", () => {
    const view = actualView(receipt, desktop, 1);
    const px = 600;
    const py = 300;
    const before = { x: (px - view.x) / view.scale, y: (py - view.y) / view.scale };
    const next = zoomAt(view, 2, px, py, receipt, desktop, 1);
    expect(next.scale).toBe(2);
    expect((px - next.x) / next.scale).toBeCloseTo(before.x);
    expect((py - next.y) / next.scale).toBeCloseTo(before.y);
  });

  it("stops at the limits and re-centres when zoomed out to fitted", () => {
    const view = actualView(receipt, desktop, 1);
    expect(zoomAt(view, 50, 10, 10, receipt, desktop, 1).scale).toBe(MAX_ZOOM);
    const out = zoomAt(view, 0.001, 10, 10, receipt, desktop, 1);
    expect(out).toEqual(fitView(receipt, desktop, 1));
  });

  it("follows a pinch's small deltas and caps a mouse notch, and up zooms in", () => {
    expect(wheelFactor(4)).toBeCloseTo(Math.exp(-0.04));
    expect(wheelFactor(100)).toBeCloseTo(Math.exp(-0.25));
    expect(wheelFactor(-100)).toBeCloseTo(Math.exp(0.25));
    expect(wheelFactor(0)).toBe(1);
  });
});

describe("mode, percent and panning", () => {
  it("names the mode from the scale, preferring actual when it also fits", () => {
    expect(zoomMode(fitScale(receipt, desktop, 2), receipt, desktop, 2)).toBe("fitted");
    expect(zoomMode(0.5, receipt, desktop, 2)).toBe("actual");
    expect(zoomMode(0.7, receipt, desktop, 2)).toBe("zoomed");
    expect(zoomMode(1, { width: 100, height: 100 }, desktop, 1)).toBe("actual");
  });

  it("reads 100% at actual pixels on any screen", () => {
    expect(zoomPercent(0.5, 2)).toBe(100);
    expect(zoomPercent(1, 2)).toBe(200);
    expect(zoomPercent(700 / 2576, 1)).toBe(27);
  });

  it("can pan only when the image is larger than the viewport", () => {
    expect(canPan(fitView(receipt, desktop, 1), receipt, desktop)).toBe(false);
    expect(canPan(actualView(receipt, desktop, 1), receipt, desktop)).toBe(true);
  });
});
