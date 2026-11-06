import { Effect } from "effect";
import { InvalidInput } from "./errors";
import { ACCEPTED_MEDIA_TYPES, MAX_UPLOAD_BYTES, type AcceptedMediaType } from "./upload-limits";

export { ACCEPTED_MEDIA_TYPES, MAX_UPLOAD_BYTES, type AcceptedMediaType };

const ascii = (bytes: Uint8Array, start: number, end: number) =>
  String.fromCharCode(...bytes.subarray(start, end));

const startsWith = (bytes: Uint8Array, signature: readonly number[]) =>
  signature.every((byte, i) => bytes[i] === byte);

/** HEIF-family brands (ISO/IEC 23008-12); `he*` brands are HEVC-coded, i.e. HEIC. */
const HEIF_BRANDS = new Set(["heic", "heix", "hevc", "hevx", "heim", "heis", "mif1", "msf1"]);

/**
 * The media type from the file's magic bytes, or null when it is not one we
 * accept. The client-declared type is never trusted: it decides the stored
 * Content-Type and what the model is told it is reading.
 */
export function sniffMediaType(bytes: Uint8Array): AcceptedMediaType | null {
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WEBP") {
    return "image/webp";
  }
  if (bytes.length >= 12 && ascii(bytes, 4, 8) === "ftyp") {
    const brand = ascii(bytes, 8, 12);
    if (HEIF_BRANDS.has(brand)) return brand.startsWith("he") ? "image/heic" : "image/heif";
  }
  if (ascii(bytes, 0, 5) === "%PDF-") return "application/pdf";
  return null;
}

export const validateUpload = (
  bytes: Uint8Array,
): Effect.Effect<AcceptedMediaType, InvalidInput> => {
  if (bytes.length === 0)
    return Effect.fail(
      new InvalidInput({ message: "The file is empty. Choose the receipt again." }),
    );
  if (bytes.length > MAX_UPLOAD_BYTES) {
    return Effect.fail(new InvalidInput({ message: "Receipt files must be 10 MB or smaller" }));
  }
  const mediaType = sniffMediaType(bytes);
  return mediaType
    ? Effect.succeed(mediaType)
    : Effect.fail(
        new InvalidInput({
          message:
            "This file isn't a readable JPEG, PNG, WebP, HEIC or PDF. It may be damaged or renamed; open it on your device to check, or export it again.",
        }),
      );
};
