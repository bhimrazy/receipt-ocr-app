import { imageSize } from "@receipt-ocr/ai/image-size";
import { CROP_OUTCOMES, CROP_SOURCES, DETECTION_LEVELS } from "./capture/crop-outcome";
import { FILTERS } from "./capture/filters";
import { ENCODING } from "./upload-encoding";
import { SIZE_IDS, type SizeId, type UploadInfo } from "./upload-prep";

/**
 * The encoding facts an upload carries for its wide event, so real bytes per pixel can be read
 * from production (Safari's encoder is the unknown). None of them can carry content: each is
 * checked against our own vocabulary, and anything else is dropped.
 */
const FIELDS = {
  size: "size_choice",
  quality: "encode_quality",
  attempts: "encode_attempts",
  filter: "encode_filter",
  rescued: "encode_rescued",
  cropOutcome: "crop_outcome",
  cropLevel: "crop_level",
  cropSeen: "crop_seen",
  cropSource: "crop_source",
} as const;

/** Puts `info` on an upload form. */
export function setUploadInfo(form: FormData, info: UploadInfo | undefined) {
  if (!info) return;
  if (info.size) form.set(FIELDS.size, info.size);
  form.set(FIELDS.quality, String(info.quality));
  form.set(FIELDS.attempts, String(info.attempts));
  if (info.filter) form.set(FIELDS.filter, info.filter);
  form.set(FIELDS.rescued, info.rescued ? "1" : "0");
  if (info.crop) {
    form.set(FIELDS.cropOutcome, info.crop.outcome);
    form.set(FIELDS.cropLevel, info.crop.level);
    form.set(FIELDS.cropSeen, info.crop.seen ? "1" : "0");
    if (info.crop.source) form.set(FIELDS.cropSource, info.crop.source);
  }
}

const QUALITIES = new Set<number>([...ENCODING.qualities, ENCODING.rescueQuality]);
const oneOf = <T extends string>(allowed: readonly T[], value: unknown): T | undefined =>
  typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : undefined;

/** What the server accepts back from a form: only known ids and the ladder's own numbers. */
export function readUploadInfo(form: FormData): {
  size_choice?: SizeId;
  encode?: { quality?: number; attempts?: number; filter?: string; rescued?: boolean };
  crop?: { outcome: string; level: string; seen: boolean; source?: string };
} {
  const quality = Number(form.get(FIELDS.quality));
  const attempts = Number(form.get(FIELDS.attempts));
  const rescued = form.get(FIELDS.rescued);
  const encode = {
    ...(QUALITIES.has(quality) ? { quality } : {}),
    ...(Number.isInteger(attempts) && attempts >= 1 && attempts <= 8 ? { attempts } : {}),
    ...(oneOf(FILTERS, form.get(FIELDS.filter))
      ? { filter: form.get(FIELDS.filter) as string }
      : {}),
    ...(rescued === "1" || rescued === "0" ? { rescued: rescued === "1" } : {}),
  };
  const size = oneOf(SIZE_IDS, form.get(FIELDS.size));
  const outcome = oneOf(CROP_OUTCOMES, form.get(FIELDS.cropOutcome));
  const level = oneOf(DETECTION_LEVELS, form.get(FIELDS.cropLevel));
  const seen = form.get(FIELDS.cropSeen);
  const source = oneOf(CROP_SOURCES, form.get(FIELDS.cropSource));
  return {
    ...(size ? { size_choice: size } : {}),
    ...(Object.keys(encode).length > 0 ? { encode } : {}),
    ...(outcome && level && (seen === "1" || seen === "0")
      ? { crop: { outcome, level, seen: seen === "1", ...(source ? { source } : {}) } }
      : {}),
  };
}

/** Pixel size and bytes per pixel, from the uploaded bytes' header (not from the client). */
export function imageFields(body: Uint8Array) {
  const size = imageSize(body);
  if (!size || size.width === 0 || size.height === 0) return {};
  return {
    width: size.width,
    height: size.height,
    bytes_per_pixel: Math.round((body.byteLength / (size.width * size.height)) * 1000) / 1000,
  };
}
