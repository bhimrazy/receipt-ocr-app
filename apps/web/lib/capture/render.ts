import { detectQuad, DETECT_EDGE, type Detection } from "./detect-quad";
import {
  isFullFrame,
  quadToPixels,
  rotatedSize,
  type EditState,
  type Rotation,
} from "./edit-state";
import { applyFilter } from "./filters";
import { straightenedSize, warpQuad, type Quad } from "./geometry";

/** Canvas rendering of an edit. Browser only; the maths lives in the pure modules beside it. */

export const OUTPUT_JPEG_QUALITY = 0.92;
/** Source pixels read for the final image; bounds memory on 48 MP phone sensors. */
const SOURCE_BUDGET = 16_000_000;
/** The straightened output; `prepareFile` then sizes it for upload, well below this. */
const OUTPUT_BUDGET = 6_000_000;

export type RenderBudget = { source: number; output: number };
export const FULL_RENDER: RenderBudget = { source: SOURCE_BUDGET, output: OUTPUT_BUDGET };
export const THUMB_RENDER: RenderBudget = { source: 400_000, output: 40_000 };

/** Decodes with EXIF orientation applied, so picked phone photos come out upright. */
export async function loadImage(blob: Blob): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(blob, { imageOrientation: "from-image" });
  } catch (error) {
    if (!(error instanceof TypeError)) throw error;
    return createImageBitmap(blob);
  }
}

function context(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("no 2d context");
  return ctx;
}

/** The image turned by `rotation`, scaled down to at most `maxPixels`. */
export function rotatedCanvas(bitmap: ImageBitmap, rotation: Rotation, maxPixels: number) {
  const scale = Math.min(1, Math.sqrt(maxPixels / (bitmap.width * bitmap.height)));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const size = rotatedSize(w, h, rotation);
  const canvas = document.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;
  const ctx = context(canvas);
  ctx.translate(size.width / 2, size.height / 2);
  ctx.rotate((rotation * Math.PI) / 180);
  ctx.drawImage(bitmap, -w / 2, -h / 2, w, h);
  return canvas;
}

/** Finds the receipt outline on a ~256 px copy; the canvas does the downscale. */
export function detectOnBitmap(bitmap: ImageBitmap): Detection {
  const canvas = rotatedCanvas(bitmap, 0, DETECT_EDGE * DETECT_EDGE);
  const ctx = context(canvas);
  return detectQuad(ctx.getImageData(0, 0, canvas.width, canvas.height));
}

/** Rotates, straightens the crop and applies the filter. */
export function renderEdit(bitmap: ImageBitmap, edit: EditState, budget: RenderBudget) {
  const rotated = rotatedCanvas(bitmap, edit.rotation, budget.source);
  if (isFullFrame(edit.quad) && edit.filter === "original") return rotated;
  const quad = quadToPixels(edit.quad, rotated.width, rotated.height);
  // Read only the crop's bounding box, not the whole photo.
  const x0 = Math.max(0, Math.floor(Math.min(...quad.map((p) => p.x))));
  const y0 = Math.max(0, Math.floor(Math.min(...quad.map((p) => p.y))));
  const x1 = Math.min(rotated.width, Math.ceil(Math.max(...quad.map((p) => p.x))));
  const y1 = Math.min(rotated.height, Math.ceil(Math.max(...quad.map((p) => p.y))));
  const src = context(rotated).getImageData(x0, y0, Math.max(1, x1 - x0), Math.max(1, y1 - y0));
  const local = quad.map((p) => ({ x: p.x - x0, y: p.y - y0 })) as Quad;
  const size = straightenedSize(local, budget.output);
  const pixels = isFullFrame(edit.quad) ? src : warpQuad(src, local, size.width, size.height);
  applyFilter(pixels, edit.filter);
  const out = document.createElement("canvas");
  out.width = pixels.width;
  out.height = pixels.height;
  context(out).putImageData(
    new ImageData(pixels.data as Uint8ClampedArray<ArrayBuffer>, pixels.width, pixels.height),
    0,
    0,
  );
  return out;
}

export function canvasToJpeg(canvas: HTMLCanvasElement, name: string): Promise<File> {
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) =>
        blob
          ? resolve(new File([blob], name, { type: "image/jpeg", lastModified: Date.now() }))
          : reject(new Error("encode failed")),
      "image/jpeg",
      OUTPUT_JPEG_QUALITY,
    ),
  );
}

export function jpegName(name: string) {
  return `${name.replace(/\.[^./]+$/, "") || "receipt"}.jpg`;
}
