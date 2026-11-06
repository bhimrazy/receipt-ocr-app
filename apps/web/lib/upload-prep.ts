import {
  ACCEPTED_MEDIA_TYPES,
  DEPLOYMENT_BODY_LIMIT_BYTES,
  MAX_UPLOAD_BYTES,
} from "@receipt-ocr/core/upload-limits";

export const MAX_EDGE = 2000;
export const JPEG_QUALITY = 0.85;
/** Within bounds and under this, the original is already small enough to keep as is. */
export const KEEP_ORIGINAL_BYTES = 500 * 1024;
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

/** Scale so the long edge is at most `max`, never upscaling. */
export function fitWithin(width: number, height: number, max = MAX_EDGE) {
  const long = Math.max(width, height);
  if (long <= max) return { width, height };
  const scale = max / long;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/**
 * Whether to re-encode. HEIC always is (so every provider can read it); otherwise only photos that are
 * oversized in pixels or bytes. A small in-bounds original is left alone.
 */
export function shouldReencode(input: {
  type: string;
  size: number;
  width: number;
  height: number;
}) {
  if (input.type === "image/heic" || input.type === "image/heif") return true;
  const within = Math.max(input.width, input.height) <= MAX_EDGE;
  return !(within && input.size <= KEEP_ORIGINAL_BYTES);
}

const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]);

function jpegName(name: string) {
  return `${name.replace(/\.[^./]+$/, "") || "receipt"}.jpg`;
}

async function encodeJpeg(bitmap: ImageBitmap, width: number, height: number): Promise<Blob> {
  const draw = (ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D) => {
    ctx.fillStyle = "#fff"; // JPEG has no alpha; a transparent PNG would turn black
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(bitmap, 0, 0, width, height);
  };
  if (typeof OffscreenCanvas !== "undefined") {
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext("2d");
    if (ctx) {
      draw(ctx);
      return canvas.convertToBlob({ type: "image/jpeg", quality: JPEG_QUALITY });
    }
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no 2d context");
  draw(ctx);
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("encode failed"))),
      "image/jpeg",
      JPEG_QUALITY,
    ),
  );
}

/**
 * Orients, downscales and re-encodes a photo as JPEG, which also drops EXIF/GPS. PDFs and anything the
 * browser can't decode (e.g. HEIC outside Safari) come back unchanged for the server to judge. Never throws.
 */
export async function prepareFile(file: File): Promise<File> {
  const type = acceptedType(file);
  if (!type || !IMAGE_TYPES.has(type) || typeof createImageBitmap === "undefined") return file;
  let bitmap: ImageBitmap | undefined;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const { width, height } = bitmap;
    if (!shouldReencode({ type, size: file.size, width, height })) return file;
    const target = fitWithin(width, height);
    const blob = await encodeJpeg(bitmap, target.width, target.height);
    // Re-encoding an in-bounds file can make it bigger; keep the original then.
    const heic = type === "image/heic" || type === "image/heif";
    if (!heic && blob.size >= file.size && target.width === width) return file;
    return new File([blob], jpegName(file.name), { type: "image/jpeg", lastModified: Date.now() });
  } catch {
    return file;
  } finally {
    bitmap?.close();
  }
}
