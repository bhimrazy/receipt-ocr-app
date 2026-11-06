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
export const MAX_ATTEMPTS = 5;
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

export type Encoder = (width: number, height: number, quality: number) => Promise<Blob>;
export interface EncodeResult {
  blob: Blob;
  width: number;
  height: number;
  quality: number;
  attempts: number;
}

/**
 * Encodes at START_QUALITY, then steps quality down to MIN_QUALITY, then shrinks by SCALE_STEP (never below
 * the short-edge floor) until the result is under `target` or `maxAttempts` is spent. Returns the smallest
 * encode it made.
 */
export async function encodeToTarget(
  encode: Encoder,
  size: { width: number; height: number },
  {
    target = TARGET_BYTES,
    maxAttempts = MAX_ATTEMPTS,
    minShort = MIN_SHORT_EDGE,
  }: { target?: number; maxAttempts?: number; minShort?: number } = {},
): Promise<EncodeResult> {
  const qualities = [START_QUALITY, 0.72, MIN_QUALITY];
  let { width, height } = size;
  const floor = Math.min(minShort, width, height);
  let quality = START_QUALITY;
  let best: Omit<EncodeResult, "attempts"> | undefined;
  let attempts = 0;
  while (attempts < maxAttempts) {
    attempts++;
    const blob = await encode(width, height, quality);
    if (!best || blob.size < best.blob.size) best = { blob, width, height, quality };
    if (blob.size <= target) break;
    const next = qualities[qualities.indexOf(quality) + 1];
    if (next !== undefined) {
      quality = next;
      continue;
    }
    const w = Math.round(width * SCALE_STEP);
    const h = Math.round(height * SCALE_STEP);
    if (Math.min(w, h) < floor) break;
    width = w;
    height = h;
  }
  return { ...best!, attempts };
}

const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]);

function jpegName(name: string) {
  return `${name.replace(/\.[^./]+$/, "") || "receipt"}.jpg`;
}

/** A reusable JPEG encoder for one decoded image; each call redraws at the requested size. */
export function jpegEncoder(bitmap: ImageBitmap): Encoder {
  const draw = (
    ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D,
    w: number,
    h: number,
  ) => {
    ctx.fillStyle = "#fff"; // JPEG has no alpha; a transparent PNG would turn black
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(bitmap, 0, 0, w, h);
  };
  return async (width, height, quality) => {
    // OffscreenCanvas encodes off the main thread's critical path where supported (all current engines).
    if (typeof OffscreenCanvas !== "undefined") {
      const canvas = new OffscreenCanvas(width, height);
      const ctx = canvas.getContext("2d");
      if (ctx) {
        draw(ctx, width, height);
        return canvas.convertToBlob({ type: "image/jpeg", quality });
      }
    }
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no 2d context");
    draw(ctx, width, height);
    return new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error("encode failed"))),
        "image/jpeg",
        quality,
      ),
    );
  };
}

/** True when a JPEG carries an APP1 (EXIF, XMP) or APP13 (IPTC) segment before its image data. */
export function jpegHasMetadata(bytes: Uint8Array): boolean {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return true;
  let i = 2;
  while (i + 4 <= bytes.length) {
    if (bytes[i] !== 0xff) return true;
    const marker = bytes[i + 1]!;
    if (marker === 0xe1 || marker === 0xed) return true;
    if (marker === 0xda || marker === 0xd9) return false;
    i += 2 + ((bytes[i + 2]! << 8) | bytes[i + 3]!);
  }
  return true;
}

/** PNG carries no camera metadata; a JPEG is clean when it has no EXIF/XMP/IPTC. WebP and HEIC are always re-encoded. */
async function isCleanOriginal(file: File, type: string) {
  if (type === "image/png") return true;
  if (type !== "image/jpeg") return false;
  return !jpegHasMetadata(new Uint8Array(await file.slice(0, 65536).arrayBuffer()));
}

/**
 * Orients, shrinks to the size budget and re-encodes every image the browser can decode as JPEG, which removes camera
 * metadata (EXIF, including GPS). PDFs, and images the browser can't decode (e.g. HEIC outside Safari), come
 * back unchanged with their metadata, for the server to judge. Never throws.
 */
export async function prepareFile(file: File): Promise<File> {
  const type = acceptedType(file);
  if (!type || !IMAGE_TYPES.has(type) || typeof createImageBitmap === "undefined") return file;
  let bitmap: ImageBitmap | undefined;
  try {
    try {
      bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch (error) {
      // Older engines reject the options bag; they apply EXIF orientation by default.
      if (!(error instanceof TypeError)) throw error;
      bitmap = await createImageBitmap(file);
    }
    const size = planSize(bitmap.width, bitmap.height);
    const { blob } = await encodeToTarget(jpegEncoder(bitmap), size);
    // Keep the original when re-encoding would only make it bigger and there is no metadata to strip.
    if (blob.size >= file.size && (await isCleanOriginal(file, type))) return file;
    return new File([blob], jpegName(file.name), { type: "image/jpeg", lastModified: Date.now() });
  } catch {
    return file;
  } finally {
    bitmap?.close();
  }
}
