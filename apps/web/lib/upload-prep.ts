import {
  ACCEPTED_MEDIA_TYPES,
  DEPLOYMENT_BODY_LIMIT_BYTES,
  MAX_UPLOAD_BYTES,
} from "@receipt-ocr/core/upload-limits";

export const MAX_EDGE = 2000;
export const JPEG_QUALITY = 0.85;
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
 * Orients, downscales and re-encodes every image the browser can decode as JPEG, which removes camera
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
    const target = fitWithin(bitmap.width, bitmap.height);
    const blob = await encodeJpeg(bitmap, target.width, target.height);
    return new File([blob], jpegName(file.name), { type: "image/jpeg", lastModified: Date.now() });
  } catch {
    return file;
  } finally {
    bitmap?.close();
  }
}
