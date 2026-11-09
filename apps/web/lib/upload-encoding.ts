/**
 * How a photo is encoded for upload, in one place so it can be tuned from telemetry
 * (docs/reviews/2026-11-09-image-compression.md). JPEG from the canvas: Safari can't encode WebP
 * or AVIF there, and no OCR provider charges less for them.
 *
 * The ladder tries each quality in turn and keeps the first encode at or under the option's
 * target. Below the last step JPEG ringing starts to touch thin printed strokes, so it never goes
 * lower. Past the ladder, anything up to the hard cap is sent; over it, the photo is encoded once
 * more at Compact's size, and refused if that is still over.
 */
export const ENCODING = {
  type: "image/jpeg",
  qualities: [0.8, 0.72, 0.65],
  /** Bytes to land under, per size option (ids as in `SIZE_IDS`). */
  targetBytes: {
    smaller: 500 * 1024,
    recommended: 700 * 1024,
    larger: 1024 * 1024,
  },
  hardCapBytes: 1.5 * 1024 * 1024,
  rescueQuality: 0.72,
} as const;

export type EncodeTarget = keyof typeof ENCODING.targetBytes;
type Size = { width: number; height: number };
export type Encoder<B extends Blob = Blob> = (
  width: number,
  height: number,
  quality: number,
) => Promise<B>;

export type Encoded<B extends Blob = Blob> = Size & {
  blob: B;
  quality: number;
  /** Encodes made, rescue included. */
  attempts: number;
  /** Sent at the rescue size because every ladder step was over the hard cap. */
  rescued: boolean;
};

/** The photo is still over `ENCODING.hardCapBytes` after the rescue encode. */
export class TooLargeError extends Error {
  constructor(readonly bytes: number) {
    super("The photo is too large to upload");
    this.name = "TooLargeError";
  }
}

/** The encoder gave back something other than JPEG (Safari returns PNG for types it can't write). */
export class WrongFormatError extends Error {
  constructor(readonly type: string) {
    super("The browser didn't encode a JPEG");
    this.name = "WrongFormatError";
  }
}

/**
 * Runs the ladder at `size`, then the rescue at `rescue` (skipped when null or not smaller).
 * Returns the smallest encode under the target, or under the hard cap. Throws `TooLargeError`
 * when nothing gets under the cap and `WrongFormatError` when the encoder returns a non-JPEG.
 */
export async function encodeLadder<B extends Blob>(
  encode: Encoder<B>,
  size: Size,
  target: EncodeTarget,
  rescue: Size | null = null,
): Promise<Encoded<B>> {
  let best: Omit<Encoded<B>, "attempts"> | undefined;
  let attempts = 0;
  const run = async (at: Size, quality: number, rescued: boolean) => {
    attempts++;
    const blob = await encode(at.width, at.height, quality);
    if (blob.type !== ENCODING.type) throw new WrongFormatError(blob.type);
    if (!best || blob.size < best.blob.size) best = { ...at, blob, quality, rescued };
    return blob.size;
  };
  for (const quality of ENCODING.qualities) {
    if ((await run(size, quality, false)) <= ENCODING.targetBytes[target]) break;
  }
  if (best!.blob.size <= ENCODING.hardCapBytes) return { ...best!, attempts };
  if (rescue && rescue.width * rescue.height < size.width * size.height) {
    await run(rescue, ENCODING.rescueQuality, true);
    if (best!.blob.size <= ENCODING.hardCapBytes) return { ...best!, attempts };
  }
  throw new TooLargeError(best!.blob.size);
}
