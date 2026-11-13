/** A width and height, in image pixels or CSS pixels as the name says. */
export type Size = { width: number; height: number };

/** A point in viewport CSS pixels. */
export type Point = { x: number; y: number };

/**
 * How the image sits in the viewport: `scale` CSS pixels per image pixel (1 is 100%), and the
 * image's top-left corner at (`x`, `y`) CSS pixels from the viewport's.
 */
export type View = { scale: number; x: number; y: number };

/** 400%. */
export const MAX_SCALE = 4;

/** One press of + or −. */
export const ZOOM_STEP = 1.25;

/** Height ÷ width from which a receipt opens fitted to its width, from the top. */
export const LONG_RATIO = 2;

const EPSILON = 1e-6;
const near = (a: number, b: number) => Math.abs(a - b) <= EPSILON * Math.max(1, a, b);

export const isLong = (image: Size) => image.height / image.width >= LONG_RATIO;

/** The whole image inside the viewport, never enlarged past 100%. */
export function fitScale(image: Size, viewport: Size) {
  return Math.min(1, viewport.width / image.width, viewport.height / image.height);
}

/** From Fit up to 400%. */
export function scaleLimits(image: Size, viewport: Size) {
  return { min: fitScale(image, viewport), max: MAX_SCALE };
}

const clampScale = (scale: number, image: Size, viewport: Size) => {
  const { min, max } = scaleLimits(image, viewport);
  return Math.min(max, Math.max(min, scale));
};

/** The allowed offsets on one axis: one centred value when the image is smaller than the viewport. */
function axisRange(content: number, viewport: number) {
  if (content <= viewport) {
    const centred = (viewport - content) / 2;
    return { low: centred, high: centred };
  }
  return { low: viewport - content, high: 0 };
}

const clampAxis = (offset: number, content: number, viewport: number) => {
  const { low, high } = axisRange(content, viewport);
  return Math.min(high, Math.max(low, offset));
};

/** The view with its scale in the limits, each axis centred or with no gap at either edge. */
export function clampView(view: View, image: Size, viewport: Size): View {
  const scale = clampScale(view.scale, image, viewport);
  return {
    scale,
    x: clampAxis(view.x, image.width * scale, viewport.width),
    y: clampAxis(view.y, image.height * scale, viewport.height),
  };
}

/**
 * Like `clampView`, but an offset past an edge is let through at a third of the distance, so a
 * touch drag stretches at the edge and springs back (to `clampView`) on release. An axis the image
 * doesn't fill stays centred, so a vertical drag never drifts sideways.
 */
export function rubberBand(view: View, image: Size, viewport: Size): View {
  const scale = clampScale(view.scale, image, viewport);
  const axis = (offset: number, content: number, size: number) => {
    const { low, high } = axisRange(content, size);
    if (low === high) return low;
    if (offset > high) return high + (offset - high) / 3;
    if (offset < low) return low - (low - offset) / 3;
    return offset;
  };
  return {
    scale,
    x: axis(view.x, image.width * scale, viewport.width),
    y: axis(view.y, image.height * scale, viewport.height),
  };
}

/** The whole image, centred. */
export const fitView = (image: Size, viewport: Size): View =>
  clampView({ scale: fitScale(image, viewport), x: 0, y: 0 }, image, viewport);

/**
 * The opening view: Fit, or for a long receipt its width fitted (capped at 100%) from the top,
 * so the header is readable at once.
 */
export function defaultView(image: Size, viewport: Size): View {
  if (!isLong(image)) return fitView(image, viewport);
  const scale = Math.min(1, viewport.width / image.width);
  return clampView({ scale, x: 0, y: 0 }, image, viewport);
}

/**
 * The view at `scale`, keeping the image point under `at` (viewport CSS pixels) where it is, as
 * far as the bounds allow.
 */
export function zoomAt(view: View, scale: number, at: Point, image: Size, viewport: Size): View {
  const next = clampScale(scale, image, viewport);
  const k = next / view.scale;
  return clampView(
    { scale: next, x: at.x - (at.x - view.x) * k, y: at.y - (at.y - view.y) * k },
    image,
    viewport,
  );
}

/**
 * The view for a pinch that started at `start` with the fingers `startDistance` apart around
 * `startMid`, now `distance` apart around `mid`: the image point that was under the midpoint
 * stays under it. Not clamped on position; pass it through `rubberBand` or `clampView`.
 */
export function pinchView(
  start: View,
  startMid: Point,
  startDistance: number,
  mid: Point,
  distance: number,
  image: Size,
  viewport: Size,
): View {
  const scale = clampScale((start.scale * distance) / Math.max(1, startDistance), image, viewport);
  const ix = (startMid.x - start.x) / start.scale;
  const iy = (startMid.y - start.y) / start.scale;
  return { scale, x: mid.x - ix * scale, y: mid.y - iy * scale };
}

/** The view moved by (`dx`, `dy`) CSS pixels, within the bounds. */
export const panBy = (view: View, dx: number, dy: number, image: Size, viewport: Size) =>
  clampView({ ...view, x: view.x + dx, y: view.y + dy }, image, viewport);

/**
 * The zoom factor for a Ctrl/Cmd + wheel delta in pixels. Trackpad pinches arrive as many small
 * deltas and follow the fingers; a mouse notch (about 100) is capped to one modest step.
 */
export const wheelFactor = (deltaY: number) => Math.exp(-Math.max(-25, Math.min(25, deltaY)) / 100);

export const isFit = (scale: number, image: Size, viewport: Size) =>
  near(scale, fitScale(image, viewport));

/**
 * The click and double-tap target: 100% from anything below it, Fit from anything above Fit, and
 * 200% when Fit already is 100% (a small image).
 */
export function toggleScale(scale: number, image: Size, viewport: Size) {
  if (scale < 1 && !near(scale, 1)) return 1;
  if (!isFit(scale, image, viewport)) return fitScale(image, viewport);
  return clampScale(2, image, viewport);
}

/** The readout's target: Fit from any other zoom, and from Fit the same step in as a click. */
export function readoutScale(scale: number, image: Size, viewport: Size) {
  if (!isFit(scale, image, viewport)) return fitScale(image, viewport);
  return toggleScale(scale, image, viewport);
}

export const zoomPercent = (scale: number) => Math.round(scale * 100);

/** Whether the image is larger than the viewport on either axis, so there is something to drag. */
export const canPan = (view: View, image: Size, viewport: Size) =>
  image.width * view.scale > viewport.width + 0.5 ||
  image.height * view.scale > viewport.height + 0.5;

/**
 * Where the visible part sits in the image height, as fractions: `start` is the top edge and
 * `size` the share shown. Null when the whole height is visible.
 */
export function verticalPosition(view: View, image: Size, viewport: Size) {
  const content = image.height * view.scale;
  if (content <= viewport.height + 0.5) return null;
  const size = viewport.height / content;
  const start = Math.min(1 - size, Math.max(0, -view.y / content));
  return { start, size };
}
