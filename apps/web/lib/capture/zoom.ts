/** A width and height, in image pixels or CSS pixels as the name says. */
export type Size = { width: number; height: number };

/**
 * How the image sits in the viewport: `scale` CSS pixels per image pixel, and the image's
 * top-left corner at (`x`, `y`) CSS pixels from the viewport's.
 */
export type View = { scale: number; x: number; y: number };

/** Fitted to show the whole image, at one image pixel per device pixel, or anything else. */
export type ZoomMode = "fitted" | "actual" | "zoomed";

/** The furthest zoom in, as a multiple of actual pixels. */
export const MAX_ZOOM = 4;

/** One press of + or −. */
export const ZOOM_STEP = 1.25;

/** One image pixel per device pixel. */
export const actualScale = (dpr: number) => 1 / (dpr > 0 ? dpr : 1);

/** The whole image inside the viewport, never enlarged past actual pixels. */
export function fitScale(image: Size, viewport: Size, dpr: number) {
  const fit = Math.min(viewport.width / image.width, viewport.height / image.height);
  return Math.min(fit, actualScale(dpr));
}

/** The zoom range: from fitted (or actual pixels, if smaller) up to MAX_ZOOM × actual pixels. */
export function scaleLimits(image: Size, viewport: Size, dpr: number) {
  const actual = actualScale(dpr);
  return { min: Math.min(fitScale(image, viewport, dpr), actual), max: MAX_ZOOM * actual };
}

/**
 * The offset on one axis: centred when the image is narrower than the viewport, otherwise kept
 * so the image always covers the viewport (no empty edge can be dragged in).
 */
function clampAxis(offset: number, content: number, viewport: number) {
  if (content <= viewport) return (viewport - content) / 2;
  return Math.min(0, Math.max(viewport - content, offset));
}

/** The view with its scale inside the limits and the image centred or covering each axis. */
export function clampView(view: View, image: Size, viewport: Size, dpr: number): View {
  const { min, max } = scaleLimits(image, viewport, dpr);
  const scale = Math.min(max, Math.max(min, view.scale));
  return {
    scale,
    x: clampAxis(view.x, image.width * scale, viewport.width),
    y: clampAxis(view.y, image.height * scale, viewport.height),
  };
}

/** The image at `scale`, centred on its middle. */
export function centredView(scale: number, image: Size, viewport: Size, dpr: number): View {
  return clampView(
    {
      scale,
      x: (viewport.width - image.width * scale) / 2,
      y: (viewport.height - image.height * scale) / 2,
    },
    image,
    viewport,
    dpr,
  );
}

export const fitView = (image: Size, viewport: Size, dpr: number) =>
  centredView(fitScale(image, viewport, dpr), image, viewport, dpr);

export const actualView = (image: Size, viewport: Size, dpr: number) =>
  centredView(actualScale(dpr), image, viewport, dpr);

/**
 * The view at `scale`, keeping the image point under (`px`, `py`) (viewport CSS pixels) where it
 * is, as far as the limits allow.
 */
export function zoomAt(
  view: View,
  scale: number,
  px: number,
  py: number,
  image: Size,
  viewport: Size,
  dpr: number,
): View {
  const { min, max } = scaleLimits(image, viewport, dpr);
  const next = Math.min(max, Math.max(min, scale));
  const k = next / view.scale;
  return clampView(
    { scale: next, x: px - (px - view.x) * k, y: py - (py - view.y) * k },
    image,
    viewport,
    dpr,
  );
}

/** The view moved by (`dx`, `dy`) CSS pixels, within the limits. */
export const panBy = (
  view: View,
  dx: number,
  dy: number,
  image: Size,
  viewport: Size,
  dpr: number,
) => clampView({ ...view, x: view.x + dx, y: view.y + dy }, image, viewport, dpr);

/**
 * The zoom factor for a Ctrl + wheel delta in pixels. Trackpad pinches arrive as many small
 * deltas and follow the fingers; a mouse notch (about 100) is capped to one modest step.
 */
export const wheelFactor = (deltaY: number) => Math.exp(-Math.max(-25, Math.min(25, deltaY)) / 100);

const near = (a: number, b: number) => Math.abs(a - b) <= 1e-6 * Math.max(a, b);

/** Actual pixels wins when it is also the fitted scale: the whole image is shown 1:1. */
export function zoomMode(scale: number, image: Size, viewport: Size, dpr: number): ZoomMode {
  if (near(scale, actualScale(dpr))) return "actual";
  if (near(scale, fitScale(image, viewport, dpr))) return "fitted";
  return "zoomed";
}

/** The scale as a percentage of actual pixels, so 1:1 reads 100%. */
export const zoomPercent = (scale: number, dpr: number) =>
  Math.round((scale / actualScale(dpr)) * 100);

/** Whether the image is larger than the viewport on either axis, so there is something to drag. */
export const canPan = (view: View, image: Size, viewport: Size) =>
  image.width * view.scale > viewport.width + 0.5 ||
  image.height * view.scale > viewport.height + 0.5;
