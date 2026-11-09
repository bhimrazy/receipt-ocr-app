import {
  ACCEPTED_MEDIA_TYPES,
  DEPLOYMENT_BODY_LIMIT_BYTES,
  MAX_UPLOAD_BYTES,
} from "@receipt-ocr/core/upload-limits";
import type { Filter } from "./capture/filters";
import { ENCODING, encodeLadder, TooLargeError, type Encoder } from "./upload-encoding";

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

/**
 * Upload sizes, set by the photo's shape and the option alone, never by how well it compresses
 * (docs/reviews/2026-11-09-upload-sizing.md). Each option fits a pixel budget, raised to keep a
 * minimum short edge (a receipt's width: pixels per millimetre of paper), and every option stays
 * within what Claude reads natively: 2,576 px on the long edge and 4,784 patches of 28 x 28 px.
 * Never upscaled. The ids predate the current labels and are kept so telemetry still compares.
 */
export const SIZE_IDS = ["smaller", "recommended", "larger"] as const;
export type SizeId = (typeof SIZE_IDS)[number];
export const MODEL_LONG_EDGE = 2576;
export const MODEL_MAX_PATCHES = 4784;
const PATCH = 28;
export const SIZE_RULES: Record<SizeId, { budget: number; minShort: number }> = {
  smaller: { budget: 1_000_000, minShort: 800 },
  recommended: { budget: 2_000_000, minShort: 1000 },
  larger: { budget: Number.POSITIVE_INFINITY, minShort: 0 },
};
/**
 * Long edge over short edge above which Standard's width no longer fits under the model's long
 * edge, so the options come out about the same: such a receipt goes at Sharpest and the picker
 * is hidden. Multi-part capture will hook in here.
 */
export const LONG_RECEIPT_RATIO = 2.6;

type Size = { width: number; height: number };
export const shortEdge = (size: Size) => Math.min(size.width, size.height);
const longEdge = (size: Size) => Math.max(size.width, size.height);
/** Claude's image tokens for a size: one per 28 x 28 px patch. */
export const modelPatches = ({ width, height }: Size) =>
  Math.ceil(width / PATCH) * Math.ceil(height / PATCH);

function scaled({ width, height }: Size, scale: number): Size {
  if (scale >= 1) return { width, height };
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/** The upload size of `source` for one option. */
export function planOption(source: Size, id: SizeId): Size {
  const { budget, minShort } = SIZE_RULES[id];
  const short = shortEdge(source);
  const long = longEdge(source);
  const area = source.width * source.height;
  let scale = Math.min(1, Math.sqrt(budget / area));
  if (short * scale < minShort) scale = Math.min(1, minShort / short);
  scale = Math.min(
    scale,
    MODEL_LONG_EDGE / long,
    Math.sqrt((MODEL_MAX_PATCHES * PATCH ** 2) / area),
  );
  let size = scaled(source, scale);
  // Patch rounding can still go one row over near square: step down a pixel at a time.
  while (modelPatches(size) > MODEL_MAX_PATCHES) size = scaled(source, (longEdge(size) - 1) / long);
  return size;
}

export type SizeOption = Size & { id: SizeId };
export type UploadPlan = {
  /** Over LONG_RECEIPT_RATIO: one option, Sharpest. */
  long: boolean;
  /** The options to offer; a single one means there is nothing to choose. */
  options: SizeOption[];
};

const sameSize = (a: Size, b: Size) => a.width === b.width && a.height === b.height;

/** What can be offered for a source. Faster upload and Sharpest are left out when they equal Standard. */
export function uploadPlan(source: Size): UploadPlan {
  if (longEdge(source) / shortEdge(source) > LONG_RECEIPT_RATIO) {
    return { long: true, options: [{ id: "larger", ...planOption(source, "larger") }] };
  }
  const standard: SizeOption = { id: "recommended", ...planOption(source, "recommended") };
  const options = SIZE_IDS.map((id) =>
    id === "recommended" ? standard : { id, ...planOption(source, id) },
  ).filter((option) => option.id === "recommended" || !sameSize(option, standard));
  return { long: false, options };
}

/** The option a photo gets: the batch's choice where it is offered, else Standard (or the only one). */
export function chosenOption(plan: UploadPlan, choice: SizeId | undefined): SizeOption {
  return (
    plan.options.find((o) => o.id === choice) ??
    plan.options.find((o) => o.id === "recommended") ??
    plan.options[0]!
  );
}

/** Pixels the encoder can draw from: a decoded photo, or a rendered edit. */
export type EncodeSource = ImageBitmap | HTMLCanvasElement;
type Ctx2D = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;
type AnyCanvas = OffscreenCanvas | HTMLCanvasElement;

/**
 * A JPEG encoder for one source. It holds a single canvas, redrawn only when the output size
 * changes, so quality steps re-encode the same pixels. Call `release` to free the canvas (iOS
 * Safari caps canvas memory).
 */
export function jpegEncoder(source: EncodeSource): { encode: Encoder; release: () => void } {
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
      c.drawImage(source, 0, 0, width, height);
      drawn = key;
    }
    const target = canvas!;
    if ("toBlob" in target) {
      return new Promise<Blob>((resolve, reject) =>
        target.toBlob(
          (blob) => (blob ? resolve(blob) : reject(new Error("encode failed"))),
          ENCODING.type,
          quality,
        ),
      );
    }
    return target.convertToBlob({ type: ENCODING.type, quality });
  };
  return { encode, release };
}

/** How an upload was encoded, for its wide event and the review sheet. No content, no file name. */
export type UploadInfo = {
  /** The option it was sent at; absent when none was asked for. */
  size?: SizeId;
  /** Pixel size of the file; the server reads its own from the bytes. */
  width: number;
  height: number;
  filter?: Filter;
  quality: number;
  attempts: number;
  rescued: boolean;
};

const infos = new WeakMap<File, UploadInfo>();

/** How `encodeUpload` made a file; undefined for a file it didn't make. */
export const uploadInfo = (file: File): UploadInfo | undefined => infos.get(file);

function jpegName(name: string) {
  return `${name.replace(/\.[^./]+$/, "") || "receipt"}.jpg`;
}

/**
 * Sizes `source` for the chosen option and runs the encoding ladder (`ENCODING`), with Faster
 * upload's size as the rescue. Throws `TooLargeError` when nothing gets under the hard cap, and
 * whatever the canvas throws.
 */
export async function encodeUpload(
  source: EncodeSource,
  name: string,
  { size, filter }: { size?: SizeId; filter?: Filter } = {},
): Promise<File> {
  const option = chosenOption(uploadPlan(source), size);
  const encoder = jpegEncoder(source);
  try {
    const out = await encodeLadder(
      encoder.encode,
      option,
      option.id,
      planOption(source, "smaller"),
    );
    const file = new File([out.blob], jpegName(name), {
      type: ENCODING.type,
      lastModified: Date.now(),
    });
    infos.set(file, {
      ...(size ? { size: option.id } : {}),
      ...(filter ? { filter } : {}),
      width: out.width,
      height: out.height,
      quality: out.quality,
      attempts: out.attempts,
      rescued: out.rescued,
    });
    return file;
  } finally {
    encoder.release();
  }
}

const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]);

/**
 * Orients, sizes and re-encodes every image the browser can decode as JPEG, which removes camera
 * metadata (EXIF, including GPS). A successful re-encode always replaces the original, even when
 * it is larger: PNG eXIf and JPEG APP segments can all carry GPS. PDFs, images the browser can't
 * decode (e.g. HEIC outside Safari) and images whose encode fails (e.g. canvas memory limits)
 * come back unchanged with their metadata. Throws only `TooLargeError`: sending the larger
 * original instead would defeat the cap.
 */
export async function prepareFile(
  file: File,
  options: { size?: SizeId; filter?: Filter } = {},
): Promise<File> {
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
    return await encodeUpload(bitmap, file.name, options);
  } catch (error) {
    if (error instanceof TooLargeError) throw error;
    return file;
  } finally {
    bitmap?.close();
  }
}
