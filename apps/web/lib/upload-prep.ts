import {
  ACCEPTED_MEDIA_TYPES,
  DEPLOYMENT_BODY_LIMIT_BYTES,
  MAX_UPLOAD_BYTES,
} from "@receipt-ocr/core/upload-limits";

/**
 * Size budget, from Gemini's own limits (ai.google.dev, image understanding and media resolution): Gemini 3
 * spends at most 1,120 tokens on an image by default (2,240 at `ultra_high`), about 4 tiles of 768 x 768
 * (~2.4 MP). Pixels beyond that are downsampled by the model, so a ~3 MP budget keeps everything it can use.
 * A long thermal receipt (1:4 to 1:6) would be only 500 px wide at that budget, too small for fine print, so
 * the short edge keeps at least 1,000 px (when the source has them) even past the budget, and the long edge
 * is capped at 6,000 px. Never upscaled.
 */
export const PIXEL_BUDGET = 3_000_000;
export const MIN_SHORT_EDGE = 1000;
export const MAX_LONG_EDGE = 6000;
/** Bytes to aim for, and the ceiling above which the loop keeps trying until it runs out of attempts. */
export const TARGET_BYTES = 500 * 1024;
export const CEILING_BYTES = 1024 * 1024;
export const START_QUALITY = 0.85;
export const MIN_QUALITY = 0.6;
export const SCALE_STEP = 0.85;
/** Last resort when the floor leaves the file over CEILING_BYTES: quality 0.5 and a short edge down to this. */
export const RESCUE_QUALITY = 0.5;
export const HARD_MIN_SHORT_EDGE = 800;
export const MAX_ATTEMPTS = 6;
/** What the file picker is told to offer. */
export const ACCEPT = ACCEPTED_MEDIA_TYPES.join(",");
/** The size a file may be at upload time: the app limit, or the tighter deployment body limit. */
export const UPLOAD_LIMIT_BYTES = Math.min(MAX_UPLOAD_BYTES, DEPLOYMENT_BODY_LIMIT_BYTES);

const EXTENSION_TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  heic: "image/heic",
  heif: "image/heif",
  pdf: "application/pdf",
};

/** The accepted media type for a picked file, or null. Some browsers leave `type` empty for HEIC. */
export function acceptedType(file: { name: string; type: string }): string | null {
  const declared = file.type.toLowerCase();
  if ((ACCEPTED_MEDIA_TYPES as readonly string[]).includes(declared)) return declared;
  if (declared) return null;
  return EXTENSION_TYPES[file.name.split(".").pop()?.toLowerCase() ?? ""] ?? null;
}

export interface SizeOptions {
  budget?: number;
  minShort?: number;
  maxLong?: number;
}

/** Output size for a source: the pixel budget, raised to the short-edge floor, capped by the long edge. */
export function planSize(
  width: number,
  height: number,
  { budget = PIXEL_BUDGET, minShort = MIN_SHORT_EDGE, maxLong = MAX_LONG_EDGE }: SizeOptions = {},
) {
  const short = Math.min(width, height);
  const long = Math.max(width, height);
  let scale = Math.min(1, Math.sqrt(budget / (width * height)));
  if (short * scale < minShort) scale = Math.min(1, minShort / short);
  scale = Math.min(scale, maxLong / long);
  if (scale >= 1) return { width, height };
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/**
 * Upload sizes the reviewer can pick instead of the automatic one, by short edge (a receipt's width). Smaller is the
 * rescue floor, HARD_MIN_SHORT_EDGE. Larger keeps 1,200 px where the automatic loop would shrink below it to reach
 * TARGET_BYTES, but only up to LARGER_MAX_PIXELS: Gemini 3 downsamples anything past about 2.4 MP, so more is wasted.
 */
export const SIZE_IDS = ["smaller", "recommended", "larger"] as const;
export type SizeId = (typeof SIZE_IDS)[number];
export const LARGER_SHORT_EDGE = 1200;
export const LARGER_MAX_PIXELS = 2_400_000;

type Size = { width: number; height: number };
export const shortEdge = (size: Size) => Math.min(size.width, size.height);

/** Scaled so the short edge is `short`, capped by the long edge; null when that isn't a downscale. */
function atShortEdge({ width, height }: Size, short: number): Size | null {
  if (short >= Math.min(width, height)) return null;
  const scale = Math.min(short / Math.min(width, height), MAX_LONG_EDGE / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/** The Smaller plan for a source, or null when its short edge is already at or under HARD_MIN_SHORT_EDGE. */
export function smallerSize(source: Size): Size | null {
  const size = atShortEdge(source, HARD_MIN_SHORT_EDGE);
  return size && shortEdge(size) >= HARD_MIN_SHORT_EDGE ? size : null;
}

/** The Larger plan for a source, or null when it would upscale or pass LARGER_MAX_PIXELS. */
export function largerSize(source: Size): Size | null {
  const size = atShortEdge(source, LARGER_SHORT_EDGE);
  return size && size.width * size.height <= LARGER_MAX_PIXELS ? size : null;
}

export type SizeOption = Size & { id: SizeId };

/**
 * The choices for a source whose automatic upload comes out at `recommended`: Smaller when it is under that, Larger
 * when it is over it. Empty when that leaves fewer than two, so there is nothing to choose.
 */
export function sizeOptions(source: Size, recommended: Size): SizeOption[] {
  const smaller = smallerSize(source);
  const larger = largerSize(source);
  const options: SizeOption[] = [
    ...(smaller && shortEdge(smaller) < shortEdge(recommended)
      ? [{ id: "smaller" as const, ...smaller }]
      : []),
    { id: "recommended", ...recommended },
    ...(larger && shortEdge(larger) > shortEdge(recommended)
      ? [{ id: "larger" as const, ...larger }]
      : []),
  ];
  return options.length < 2 ? [] : options;
}

export type Encoder = (width: number, height: number, quality: number) => Promise<Blob>;
export interface EncodeResult<B extends { size: number } = Blob> {
  blob: B;
  width: number;
  height: number;
  quality: number;
  attempts: number;
}

/**
 * Encodes at START_QUALITY, then steps quality down to MIN_QUALITY, then shrinks by SCALE_STEP (never below
 * the short-edge floor) until the result is under `target` or `maxAttempts` is spent. If the floor stops the
 * scaling with the best result still over `ceiling`, it tries RESCUE_QUALITY and keeps scaling down to
 * HARD_MIN_SHORT_EDGE until under the ceiling. Returns the smallest encode it made.
 */
export async function encodeToTarget<B extends { size: number } = Blob>(
  encode: (width: number, height: number, quality: number) => Promise<B>,
  size: { width: number; height: number },
  {
    target = TARGET_BYTES,
    ceiling = CEILING_BYTES,
    maxAttempts = MAX_ATTEMPTS,
    minShort = MIN_SHORT_EDGE,
  }: { target?: number; ceiling?: number; maxAttempts?: number; minShort?: number } = {},
): Promise<EncodeResult<B>> {
  const qualities = [START_QUALITY, 0.72, MIN_QUALITY];
  const budget = Math.max(1, maxAttempts);
  let { width, height } = size;
  let floor = Math.min(minShort, width, height);
  let quality = START_QUALITY;
  let rescue = false;
  let best: Omit<EncodeResult<B>, "attempts"> | undefined;
  let attempts = 0;
  while (attempts < budget) {
    attempts++;
    const blob = await encode(width, height, quality);
    if (!best || blob.size < best.blob.size) best = { blob, width, height, quality };
    if (blob.size <= (rescue ? ceiling : target)) break;
    const step = qualities.indexOf(quality);
    const next = step < 0 ? undefined : qualities[step + 1];
    if (next !== undefined) {
      quality = next;
      continue;
    }
    const w = Math.round(width * SCALE_STEP);
    const h = Math.round(height * SCALE_STEP);
    if (Math.min(w, h) < floor) {
      if (rescue || best.blob.size <= ceiling) break;
      rescue = true;
      quality = RESCUE_QUALITY;
      floor = Math.min(HARD_MIN_SHORT_EDGE, floor);
      continue;
    }
    width = w;
    height = h;
  }
  return { ...best!, attempts };
}

/**
 * The size an upload will end up at, without encoding: runs the same `encodeToTarget` loop over a
 * byte model, where a start-quality encode costs `bytesPerPixel` per pixel and lower qualities
 * scale it down in proportion (an approximation, so the result leans high).
 */
export async function predictEncode(
  size: { width: number; height: number },
  bytesPerPixel: number,
  { minShort }: { minShort?: number } = {},
) {
  const { blob, width, height } = await encodeToTarget(
    async (w, h, q) => ({
      size: Math.round((bytesPerPixel * w * h * q) / START_QUALITY),
    }),
    size,
    { minShort },
  );
  return { width, height, bytes: blob.size };
}

const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]);

function jpegName(name: string) {
  return `${name.replace(/\.[^./]+$/, "") || "receipt"}.jpg`;
}

type Ctx2D = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;
type AnyCanvas = OffscreenCanvas | HTMLCanvasElement;

/**
 * A JPEG encoder for one decoded image. It holds a single canvas, redrawn only when the output size changes,
 * so quality steps re-encode the same pixels. Call `release` to free the canvas (iOS Safari caps canvas memory).
 */
export function jpegEncoder(bitmap: ImageBitmap): { encode: Encoder; release: () => void } {
  let canvas: AnyCanvas | undefined;
  let ctx: Ctx2D | null = null;
  let drawn = "";
  const release = () => {
    if (canvas) canvas.width = canvas.height = 0;
    canvas = undefined;
    ctx = null;
    drawn = "";
  };
  const open = (width: number, height: number) => {
    // OffscreenCanvas keeps encoding off the main thread's critical path where supported.
    if (typeof OffscreenCanvas !== "undefined") {
      canvas = new OffscreenCanvas(width, height);
      ctx = canvas.getContext("2d");
    }
    if (!ctx) {
      const el = document.createElement("canvas");
      el.width = width;
      el.height = height;
      canvas = el;
      ctx = el.getContext("2d");
    }
    if (!ctx) throw new Error("no 2d context");
  };
  const encode: Encoder = async (width, height, quality) => {
    const key = `${width}x${height}`;
    if (drawn !== key) {
      release();
      open(width, height);
      const c = ctx!;
      c.imageSmoothingQuality = "high";
      c.fillStyle = "#fff"; // JPEG has no alpha; a transparent PNG would turn black
      c.fillRect(0, 0, width, height);
      c.drawImage(bitmap, 0, 0, width, height);
      drawn = key;
    }
    const target = canvas!;
    if ("toBlob" in target) {
      return new Promise<Blob>((resolve, reject) =>
        target.toBlob(
          (blob) => (blob ? resolve(blob) : reject(new Error("encode failed"))),
          "image/jpeg",
          quality,
        ),
      );
    }
    return target.convertToBlob({ type: "image/jpeg", quality });
  };
  return { encode, release };
}

const keep = (encode: Encoder, size: Size) =>
  encodeToTarget(encode, size, { minShort: shortEdge(size) });

async function encodeChoice(
  encode: Encoder,
  source: Size,
  size: SizeId | undefined,
): Promise<{ blob: Blob; applied: SizeId }> {
  const smaller = size === "smaller" ? smallerSize(source) : null;
  if (smaller) return { blob: (await keep(encode, smaller)).blob, applied: "smaller" };
  const automatic = await encodeToTarget(encode, planSize(source.width, source.height));
  const larger = size === "larger" ? largerSize(source) : null;
  if (larger && shortEdge(larger) > shortEdge(automatic)) {
    return { blob: (await keep(encode, larger)).blob, applied: "larger" };
  }
  return { blob: automatic.blob, applied: "recommended" };
}

const appliedSizes = new WeakMap<File, SizeId>();

/** The size `prepareFile` gave a file it was asked to size, for upload telemetry. */
export const appliedSize = (file: File): SizeId | undefined => appliedSizes.get(file);

/**
 * Orients, shrinks to the size budget and re-encodes every image the browser can decode as JPEG, which removes camera
 * metadata (EXIF, including GPS). A successful re-encode always replaces the original, even when it is larger: PNG
 * eXIf and JPEG APP segments can all carry GPS. PDFs, images the browser can't decode (e.g. HEIC outside Safari) and
 * images whose encode fails (e.g. canvas memory limits) come back unchanged with their metadata. Never throws.
 *
 * `size` is the reviewer's choice: Smaller and Larger keep their short edge (only quality steps down, unless the file
 * would pass CEILING_BYTES); Larger applies only where the automatic encode came out under it. Where a choice
 * doesn't apply, or without one, the image gets the automatic plan. `appliedSize` reports which one it got.
 */
export async function prepareFile(file: File, size?: SizeId): Promise<File> {
  const type = acceptedType(file);
  if (!type || !IMAGE_TYPES.has(type) || typeof createImageBitmap === "undefined") return file;
  let bitmap: ImageBitmap | undefined;
  let encoder: ReturnType<typeof jpegEncoder> | undefined;
  try {
    try {
      bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch (error) {
      // Older engines reject the options bag; they apply EXIF orientation by default.
      if (!(error instanceof TypeError)) throw error;
      bitmap = await createImageBitmap(file);
    }
    encoder = jpegEncoder(bitmap);
    const { blob, applied } = await encodeChoice(encoder.encode, bitmap, size);
    const out = new File([blob], jpegName(file.name), {
      type: "image/jpeg",
      lastModified: Date.now(),
    });
    if (size) appliedSizes.set(out, applied);
    return out;
  } catch {
    return file;
  } finally {
    encoder?.release();
    bitmap?.close();
  }
}
