// Image preparation for the OCR benchmark: what gets sent to the model, in memory only.
// Sources are read, never written.
import sharp from "sharp";
import { encodeLadder, ENCODING, type Encoder } from "../../apps/web/lib/upload-encoding";
import { planOption } from "../../apps/web/lib/upload-prep";

/**
 * - `none`: the file as is.
 * - `app`: the app's own upload at its default option, Standard (pixel budget, short-edge floor,
 *   model long-edge cap, quality ladder), with sharp standing in for the browser canvas.
 * - `long:<px>`: longest edge at most px.
 * - `short:<px>[/<maxLong>]`: shortest edge down to px, longest edge capped (default 6000, kept from
 *   earlier runs so their labels still compare).
 * The resizing modes never upscale and re-encode as JPEG quality 85, as the app does.
 */
export type PrepSpec =
  | { kind: "none" }
  | { kind: "app" }
  | { kind: "long"; px: number }
  | { kind: "short"; px: number; maxLong: number };

export type Prepared = {
  data: Uint8Array;
  mediaType: string;
  /** Pixel size sent; null for a PDF or a file sent untouched whose size wasn't read. */
  width: number | null;
  height: number | null;
  /** False when the spec didn't apply (PDFs are always sent as is, as in the app). */
  applied: boolean;
};

const JPEG_QUALITY = 85;
const MAX_LONG_EDGE = 6000;
const RESIZABLE = new Set(["image/jpeg", "image/png", "image/webp"]);

const px = (value: string, spec: string) => {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 100 || n > 10_000) {
    throw new Error(`--prep ${spec}: pixel size must be a whole number from 100 to 10000`);
  }
  return n;
};

export function parsePrep(spec: string): PrepSpec {
  if (spec === "none" || spec === "app") return { kind: spec };
  const [kind, rest = ""] = spec.split(":");
  if (kind === "long") return { kind, px: px(rest, spec) };
  if (kind === "short") {
    const [short = "", maxLong] = rest.split("/");
    return { kind, px: px(short, spec), maxLong: maxLong ? px(maxLong, spec) : MAX_LONG_EDGE };
  }
  throw new Error(`unknown --prep "${spec}" (none, app, long:<px>, short:<px>[/<maxLong>])`);
}

export const prepLabel = (spec: PrepSpec) =>
  spec.kind === "long"
    ? `long:${spec.px}`
    : spec.kind === "short"
      ? `short:${spec.px}${spec.maxLong === MAX_LONG_EDGE ? "" : `/${spec.maxLong}`}`
      : spec.kind;

/** Scale for a resizing spec; never above 1. */
export function scaleFor(spec: PrepSpec, width: number, height: number) {
  const long = Math.max(width, height);
  const short = Math.min(width, height);
  if (spec.kind === "long") return Math.min(1, spec.px / long);
  if (spec.kind === "short") return Math.min(1, spec.px / short, spec.maxLong / long);
  return 1;
}

/** Oriented (EXIF) pixels on white, like the canvas the app draws on; sharp drops metadata on output. */
const base = (data: Uint8Array) => sharp(data).rotate().flatten({ background: "#ffffff" });

const jpeg = async (data: Uint8Array, width: number, height: number, quality: number) =>
  new Uint8Array(
    await base(data)
      .resize(width, height, { fit: "fill" })
      .jpeg({ quality: Math.round(quality) })
      .toBuffer(),
  );

export async function prepare(
  data: Uint8Array,
  mediaType: string,
  spec: PrepSpec,
): Promise<Prepared> {
  if (!RESIZABLE.has(mediaType)) {
    return { data, mediaType, width: null, height: null, applied: spec.kind === "none" };
  }
  // Size after EXIF orientation, which is what both the browser and the model see.
  const meta = await base(data).toBuffer({ resolveWithObject: true });
  const { width, height } = meta.info;
  if (spec.kind === "none") return { data, mediaType, width, height, applied: true };

  if (spec.kind === "app") {
    const encode: Encoder = async (w, h, quality) =>
      new Blob([await jpeg(data, w, h, quality * 100)], { type: ENCODING.type });
    const source = { width, height };
    const result = await encodeLadder(
      encode,
      planOption(source, "recommended"),
      "recommended",
      planOption(source, "smaller"),
    );
    return {
      data: new Uint8Array(await result.blob.arrayBuffer()),
      mediaType: "image/jpeg",
      width: result.width,
      height: result.height,
      applied: true,
    };
  }

  const scale = scaleFor(spec, width, height);
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));
  return {
    data: await jpeg(data, w, h, JPEG_QUALITY),
    mediaType: "image/jpeg",
    width: w,
    height: h,
    applied: true,
  };
}

/**
 * Image input tokens, for the dry run. Claude 4.7 and later (all of Haiku, Sonnet and Opus 5.5) are
 * on the high-resolution tier: an image is scaled down to fit a 2576 px long edge and 4784 visual
 * tokens, then costs ceil(w/28) x ceil(h/28)
 * (https://platform.claude.com/docs/en/build-with-claude/vision, checked 2026-11-07).
 * Gemini 3 spends a fixed 1120 tokens per image at the default media resolution
 * (https://ai.google.dev/gemini-api/docs/media-resolution, checked 2026-11-07).
 * Null when the size isn't known (a PDF).
 */
export function imageTokens(provider: string, width: number | null, height: number | null) {
  if (provider === "google") return 1120;
  // Groq docs: each image counts as 2048 input tokens (qwen/qwen3.8-27b).
  if (provider === "groq") return 2048;
  if (width === null || height === null) return null;
  // OpenAI patch models (high detail): 32 px patches, scaled down to a 2048 px side and 2,500
  // patches (https://developers.openai.com/api/docs/guides/images-vision, checked 2026-11-07).
  // The docs give no multiplier for the offered models, so this counts 1 token per patch.
  if (provider === "openai") {
    const patches = (s: number) => Math.ceil((width * s) / 32) * Math.ceil((height * s) / 32);
    let scale = Math.min(1, 2048 / Math.max(width, height));
    while (patches(scale) > 2500) scale *= 0.99;
    return patches(scale);
  }
  const tokens = (s: number) => Math.ceil((width * s) / 28) * Math.ceil((height * s) / 28);
  let scale = Math.min(1, 2576 / Math.max(width, height));
  while (tokens(scale) > 4784) scale *= 0.99;
  return tokens(scale);
}
