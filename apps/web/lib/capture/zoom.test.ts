import { describe, expect, it } from "vitest";
import {
  canPan,
  clampView,
  defaultView,
  fitScale,
  fitView,
  isFit,
  isLong,
  MAX_SCALE,
  panBy,
  pinchView,
  rubberBand,
  scaleLimits,
  toggleScale,
  verticalPosition,
  wheelFactor,
  zoomAt,
  zoomPercent,
} from "./zoom";

const long = { width: 909, height: 2576 };
const ordinary = { width: 1000, height: 1300 };
const desktop = { width: 1088, height: 800 };
const phone = { width: 390, height: 700 };

describe("fit and the opening view", () => {
  it("fits the whole image, never past 100%", () => {
    expect(fitScale(ordinary, desktop)).toBeCloseTo(800 / 1300);
    expect(fitScale({ width: 200, height: 100 }, desktop)).toBe(1);
  });

  it("opens an ordinary receipt at Fit, centred on both axes", () => {
    for (const viewport of [desktop, phone]) {
      const view = defaultView(ordinary, viewport);
      expect(view.scale).toBeCloseTo(fitScale(ordinary, viewport));
      expect(view.x).toBeCloseTo((viewport.width - ordinary.width * view.scale) / 2);
      expect(view.y).toBeCloseTo((viewport.height - ordinary.height * view.scale) / 2);
    }
  });

  it("opens a long receipt at its width, capped at 100%, from the top", () => {
    expect(isLong(long)).toBe(true);
    expect(isLong(ordinary)).toBe(false);
    // Desktop: 909 px wide at 100%, centred across the wider stage.
    expect(defaultView(long, desktop)).toEqual({ scale: 1, x: (1088 - 909) / 2, y: 0 });
    // Phone: the full width, from the top.
    const view = defaultView(long, phone);
    expect(view.scale).toBeCloseTo(390 / 909);
    expect(view.x).toBeCloseTo(0);
    expect(view.y).toBe(0);
  });

  it("zooms from Fit to 400%", () => {
    expect(scaleLimits(long, desktop)).toEqual({ min: 800 / 2576, max: MAX_SCALE });
    expect(clampView({ scale: 100, x: 0, y: 0 }, long, desktop).scale).toBe(MAX_SCALE);
    expect(clampView({ scale: 0.01, x: 0, y: 0 }, long, desktop).scale).toBeCloseTo(800 / 2576);
  });
});

describe("bounds", () => {
  it("keeps the image edge at the viewport edge, and a smaller axis centred", () => {
    const view = defaultView(long, desktop);
    expect(panBy(view, 0, 5000, long, desktop).y).toBe(0);
    expect(panBy(view, 0, -5000, long, desktop).y).toBe(800 - 2576);
    expect(panBy(view, 400, 0, long, desktop).x).toBeCloseTo((1088 - 909) / 2);
  });

  it("lets a touch drag stretch a third past the edge", () => {
    const view = defaultView(long, desktop);
    expect(rubberBand({ ...view, y: 90 }, long, desktop).y).toBeCloseTo(30);
    expect(rubberBand({ ...view, y: 800 - 2576 - 30 }, long, desktop).y).toBeCloseTo(
      800 - 2576 - 10,
    );
    expect(rubberBand({ ...view, y: -100 }, long, desktop).y).toBe(-100);
  });
});

describe("zooming at a point", () => {
  const imagePoint = (
    view: { scale: number; x: number; y: number },
    p: { x: number; y: number },
  ) => ({
    x: (p.x - view.x) / view.scale,
    y: (p.y - view.y) / view.scale,
  });

  it("keeps the image point under the pointer in place", () => {
    const view = fitView(ordinary, desktop);
    const at = { x: 600, y: 300 };
    const next = zoomAt(view, 2, at, ordinary, desktop);
    expect(next.scale).toBe(2);
    expect(imagePoint(next, at).x).toBeCloseTo(imagePoint(view, at).x);
    expect(imagePoint(next, at).y).toBeCloseTo(imagePoint(view, at).y);
  });

  it("stops at the limits and re-centres at Fit", () => {
    const view = defaultView(long, desktop);
    expect(zoomAt(view, 50, { x: 10, y: 10 }, long, desktop).scale).toBe(MAX_SCALE);
    expect(zoomAt(view, 0.001, { x: 10, y: 10 }, long, desktop)).toEqual(fitView(long, desktop));
  });

  it("pinches around the midpoint and follows it as it moves", () => {
    const start = fitView(ordinary, phone);
    const mid = { x: 200, y: 300 };
    const moved = { x: 220, y: 280 };
    const next = pinchView(start, mid, 100, moved, 250, ordinary, phone);
    expect(next.scale).toBeCloseTo(start.scale * 2.5);
    expect(imagePoint(next, moved).x).toBeCloseTo(imagePoint(start, mid).x);
    expect(imagePoint(next, moved).y).toBeCloseTo(imagePoint(start, mid).y);
    expect(pinchView(start, mid, 10, mid, 10_000, ordinary, phone).scale).toBe(MAX_SCALE);
  });

  it("follows a trackpad pinch's small deltas and caps a mouse notch; up zooms in", () => {
    expect(wheelFactor(4)).toBeCloseTo(Math.exp(-0.04));
    expect(wheelFactor(100)).toBeCloseTo(Math.exp(-0.25));
    expect(wheelFactor(-100)).toBeCloseTo(Math.exp(0.25));
    expect(wheelFactor(0)).toBe(1);
  });
});

describe("toggle, readout and position", () => {
  it("toggles Fit to 100% and anything above Fit back to Fit", () => {
    const fit = fitScale(long, desktop);
    expect(toggleScale(fit, long, desktop)).toBe(1);
    expect(toggleScale(1, long, desktop)).toBeCloseTo(fit);
    expect(toggleScale(3, long, desktop)).toBeCloseTo(fit);
    expect(toggleScale(0.6, long, desktop)).toBe(1);
    // Fit is already 100%: go to 200%.
    expect(toggleScale(1, { width: 200, height: 100 }, desktop)).toBe(2);
  });

  it("reads 100% at one image pixel per CSS pixel", () => {
    expect(zoomPercent(1)).toBe(100);
    expect(zoomPercent(800 / 2576)).toBe(31);
    expect(isFit(800 / 2576, long, desktop)).toBe(true);
    expect(isFit(1, long, desktop)).toBe(false);
  });

  it("can pan only when the image is larger than the viewport", () => {
    expect(canPan(fitView(long, desktop), long, desktop)).toBe(false);
    expect(canPan(defaultView(long, desktop), long, desktop)).toBe(true);
  });

  it("places the visible band in the image height", () => {
    const top = defaultView(long, desktop);
    expect(verticalPosition(top, long, desktop)).toEqual({ start: 0, size: 800 / 2576 });
    const bottom = panBy(top, 0, -5000, long, desktop);
    expect(verticalPosition(bottom, long, desktop)!.start).toBeCloseTo(1 - 800 / 2576);
    expect(verticalPosition(fitView(long, desktop), long, desktop)).toBeNull();
  });
});
