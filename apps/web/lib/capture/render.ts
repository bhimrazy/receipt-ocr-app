import { detectQuad, DETECT_EDGE, type Detection } from "./detect-quad";
import {
  editKey,
  isFullFrame,
  quadToPixels,
  rotatedSize,
  type EditState,
  type Rotation,
} from "./edit-state";
import { applyFilter } from "./filters";
import { straightenedSize, warpQuad, type Pixels, type Quad } from "./geometry";

/** Canvas rendering of an edit. Browser only; the maths lives in the pure modules beside it. */

export const OUTPUT_JPEG_QUALITY = 0.92;
/** Source pixels read for the final image; bounds memory on 48 MP phone sensors. */
const SOURCE_BUDGET = 16_000_000;
/** The straightened output; `prepareFile` then sizes it for upload, well below this. */
const OUTPUT_BUDGET = 6_000_000;

export type RenderBudget = { source: number; output: number };
export const FULL_RENDER: RenderBudget = { source: SOURCE_BUDGET, output: OUTPUT_BUDGET };
export const PREVIEW_RENDER: RenderBudget = { source: 2_000_000, output: 1_500_000 };
export const THUMB_RENDER: RenderBudget = { source: 400_000, output: 40_000 };

/** Frees a canvas's pixel memory now rather than at garbage collection (iOS caps the total). */
export function releaseCanvas(canvas: HTMLCanvasElement) {
  canvas.width = canvas.height = 0;
}

/** Natural size with EXIF orientation applied, read without decoding the pixels; null if unknown. */
function naturalSize(blob: Blob): Promise<{ width: number; height: number } | null> {
  if (typeof Image === "undefined" || typeof URL.createObjectURL !== "function") {
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    const done = (size: { width: number; height: number } | null) => {
      URL.revokeObjectURL(url);
      img.onload = img.onerror = null;
      img.src = "";
      resolve(size);
    };
    img.onload = () =>
      done(img.naturalWidth ? { width: img.naturalWidth, height: img.naturalHeight } : null);
    img.onerror = () => done(null);
    img.src = url;
  });
}

/**
 * Decodes with EXIF orientation applied, so picked phone photos come out upright. Photos over
 * SOURCE_BUDGET are decoded straight to that size (a 48 MP photo would need ~200 MB as a full
 * bitmap); the size is read from the header first.
 */
export async function loadImage(blob: Blob): Promise<ImageBitmap> {
  const size = await naturalSize(blob);
  const scale = size ? Math.sqrt(SOURCE_BUDGET / (size.width * size.height)) : 1;
  if (!size || scale >= 1) return decode(blob);
  const width = Math.max(1, Math.floor(size.width * scale));
  const height = Math.max(1, Math.floor(size.height * scale));
  let bitmap = await decode(blob, { resizeWidth: width, resizeHeight: height });
  // An engine that resizes before orienting returns the rotated photo squashed: redo it.
  if (width !== height && bitmap.width === height && bitmap.height === width) {
    bitmap.close();
    bitmap = await decode(blob, { resizeWidth: height, resizeHeight: width });
  }
  return bitmap;
}

async function decode(blob: Blob, resize: ImageBitmapOptions = {}): Promise<ImageBitmap> {
  const sized: ImageBitmapOptions = resize.resizeWidth ? { ...resize, resizeQuality: "high" } : {};
  try {
    return await createImageBitmap(blob, { imageOrientation: "from-image", ...sized });
  } catch (error) {
    if (!(error instanceof TypeError)) throw error;
    // Older engines reject the options bag; they orient by default and never see the budget.
    return createImageBitmap(blob);
  }
}

function context(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("no 2d context");
  return ctx;
}

function scaledSize(bitmap: { width: number; height: number }, maxPixels: number) {
  const scale = Math.min(1, Math.sqrt(maxPixels / (bitmap.width * bitmap.height)));
  return {
    w: Math.max(1, Math.round(bitmap.width * scale)),
    h: Math.max(1, Math.round(bitmap.height * scale)),
  };
}

/** The image turned by `rotation`, scaled down to at most `maxPixels`. */
export function rotatedCanvas(bitmap: ImageBitmap, rotation: Rotation, maxPixels: number) {
  const { w, h } = scaledSize(bitmap, maxPixels);
  const size = rotatedSize(w, h, rotation);
  const canvas = document.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;
  try {
    const ctx = context(canvas);
    ctx.translate(size.width / 2, size.height / 2);
    ctx.rotate((rotation * Math.PI) / 180);
    ctx.drawImage(bitmap, -w / 2, -h / 2, w, h);
    return canvas;
  } catch (error) {
    releaseCanvas(canvas);
    throw error;
  }
}

/** Finds the receipt outline on a ~256 px copy; the canvas does the downscale. */
export function detectOnBitmap(bitmap: ImageBitmap): Detection {
  const canvas = rotatedCanvas(bitmap, 0, DETECT_EDGE * DETECT_EDGE);
  try {
    return detectQuad(context(canvas).getImageData(0, 0, canvas.width, canvas.height));
  } finally {
    releaseCanvas(canvas);
  }
}

const isPlain = (edit: EditState) => isFullFrame(edit.quad) && edit.filter === "original";

/** The crop's bounding box in the rotated image, and the corners relative to it. */
function cropBox(edit: EditState, width: number, height: number) {
  const quad = quadToPixels(edit.quad, width, height);
  const x0 = Math.max(0, Math.floor(Math.min(...quad.map((p) => p.x))));
  const y0 = Math.max(0, Math.floor(Math.min(...quad.map((p) => p.y))));
  const x1 = Math.min(width, Math.ceil(Math.max(...quad.map((p) => p.x))));
  const y1 = Math.min(height, Math.ceil(Math.max(...quad.map((p) => p.y))));
  const local = quad.map((p) => ({ x: p.x - x0, y: p.y - y0 })) as Quad;
  return { x0, y0, w: Math.max(1, x1 - x0), h: Math.max(1, y1 - y0), local };
}

/** The size `renderEdit` would produce, without rendering. */
export function renderedSize(
  bitmap: { width: number; height: number },
  edit: EditState,
  budget: RenderBudget,
) {
  const { w, h } = scaledSize(bitmap, budget.source);
  const rotated = rotatedSize(w, h, edit.rotation);
  if (isPlain(edit)) return rotated;
  const box = cropBox(edit, rotated.width, rotated.height);
  return isFullFrame(edit.quad)
    ? { width: box.w, height: box.h }
    : straightenedSize(box.local, budget.output);
}

/** The rotated, cropped and straightened pixels, before any filter. */
function straightened(bitmap: ImageBitmap, edit: EditState, budget: RenderBudget): Pixels {
  const rotated = rotatedCanvas(bitmap, edit.rotation, budget.source);
  try {
    // Read only the crop's bounding box, not the whole photo.
    const box = cropBox(edit, rotated.width, rotated.height);
    const src = context(rotated).getImageData(box.x0, box.y0, box.w, box.h);
    const size = straightenedSize(box.local, budget.output);
    return isFullFrame(edit.quad) ? src : warpQuad(src, box.local, size.width, size.height);
  } finally {
    releaseCanvas(rotated);
  }
}

/**
 * The few most recent straightened results of the small renders, so a filter change, the four
 * filter thumbnails and the size estimate of one crop warp once. Dropped when the photo changes.
 */
const CACHE_ENTRIES = 4;
let cache: { bitmap: ImageBitmap; entries: Map<string, Pixels> } | null = null;

function cachedStraightened(bitmap: ImageBitmap, edit: EditState, budget: RenderBudget): Pixels {
  if (cache?.bitmap !== bitmap) cache = { bitmap, entries: new Map() };
  const key = `${budget.source}:${budget.output}:${editKey({ ...edit, filter: "original" })}`;
  const hit = cache.entries.get(key);
  if (hit) {
    cache.entries.delete(key);
    cache.entries.set(key, hit);
    return hit;
  }
  const made = straightened(bitmap, edit, budget);
  cache.entries.set(key, made);
  if (cache.entries.size > CACHE_ENTRIES) cache.entries.delete(cache.entries.keys().next().value!);
  return made;
}

/** Frees the cached pixels (up to about 24 MB) once their photo is closed. */
export function dropRenderCache(bitmap: ImageBitmap) {
  if (cache?.bitmap === bitmap) cache = null;
}

/**
 * Rotates, straightens the crop and applies the filter. Intermediate canvases are released
 * here; the caller releases the one returned (`releaseCanvas`) once it is encoded. The small
 * renders reuse the straightened pixels of an earlier render of the same crop (the filter runs
 * on a copy); the full-size render used for upload never caches, as its pixels are large.
 */
export function renderEdit(bitmap: ImageBitmap, edit: EditState, budget: RenderBudget) {
  if (isPlain(edit)) return rotatedCanvas(bitmap, edit.rotation, budget.source);
  const shared = budget !== FULL_RENDER;
  const base = shared
    ? cachedStraightened(bitmap, edit, budget)
    : straightened(bitmap, edit, budget);
  const pixels: Pixels = shared
    ? { data: new Uint8ClampedArray(base.data), width: base.width, height: base.height }
    : base;
  applyFilter(pixels, edit.filter);
  const out = document.createElement("canvas");
  out.width = pixels.width;
  out.height = pixels.height;
  try {
    context(out).putImageData(
      new ImageData(pixels.data as Uint8ClampedArray<ArrayBuffer>, pixels.width, pixels.height),
      0,
      0,
    );
    return out;
  } catch (error) {
    releaseCanvas(out);
    throw error;
  }
}

function canvasToBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("encode failed"))),
      "image/jpeg",
      quality,
    ),
  );
}

/** Renders and encodes an edit at full size, releasing the canvas whether or not it encodes. */
export async function renderToJpeg(bitmap: ImageBitmap, edit: EditState, name: string) {
  const canvas = renderEdit(bitmap, edit, FULL_RENDER);
  try {
    const blob = await canvasToBlob(canvas, OUTPUT_JPEG_QUALITY);
    return new File([blob], jpegName(name), { type: "image/jpeg", lastModified: Date.now() });
  } finally {
    releaseCanvas(canvas);
  }
}

/** A small preview as a data URL; the canvas is released straight after. */
export function renderPreview(
  bitmap: ImageBitmap,
  edit: EditState,
  budget: RenderBudget,
  quality = 0.8,
) {
  const canvas = renderEdit(bitmap, edit, budget);
  try {
    return canvas.toDataURL("image/jpeg", quality);
  } finally {
    releaseCanvas(canvas);
  }
}

/** A small render for the size estimate; released after encoding. */
export async function renderSmall(
  bitmap: ImageBitmap,
  edit: EditState,
  budget: RenderBudget,
  quality: number,
) {
  const canvas = renderEdit(bitmap, edit, budget);
  try {
    return {
      blob: await canvasToBlob(canvas, quality),
      width: canvas.width,
      height: canvas.height,
    };
  } finally {
    releaseCanvas(canvas);
  }
}

export function jpegName(name: string) {
  return `${name.replace(/\.[^./]+$/, "") || "receipt"}.jpg`;
}
