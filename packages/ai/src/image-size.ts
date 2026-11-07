/**
 * Pixel size from an image's header, without decoding it: PNG, JPEG, WebP and GIF. Null when
 * the header isn't one of those or is cut short. Stored dimensions, before any EXIF rotation;
 * the max-edge check this serves doesn't care which way round they are.
 */
export function imageSize(data: Uint8Array): { width: number; height: number } | null {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const at = (offset: number, ascii: string) =>
    ascii.split("").every((char, i) => data[offset + i] === char.charCodeAt(0));
  const fits = (end: number) => end <= data.byteLength;

  // PNG: signature, then IHDR's width and height (big-endian).
  if (fits(24) && data[0] === 0x89 && at(1, "PNG") && at(12, "IHDR")) {
    return { width: view.getUint32(16), height: view.getUint32(20) };
  }
  // GIF: logical screen size (little-endian).
  if (fits(10) && at(0, "GIF8")) {
    return { width: view.getUint16(6, true), height: view.getUint16(8, true) };
  }
  // WebP: RIFF container with a VP8, VP8L or VP8X first chunk.
  if (fits(30) && at(0, "RIFF") && at(8, "WEBP")) {
    if (at(12, "VP8 ")) {
      return {
        width: view.getUint16(26, true) & 0x3fff,
        height: view.getUint16(28, true) & 0x3fff,
      };
    }
    if (at(12, "VP8L")) {
      const bits = view.getUint32(21, true);
      return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
    }
    if (at(12, "VP8X")) {
      const read24 = (o: number) => data[o]! | (data[o + 1]! << 8) | (data[o + 2]! << 16);
      return { width: read24(24) + 1, height: read24(27) + 1 };
    }
    return null;
  }
  // JPEG: walk the segments to the first start-of-frame marker.
  if (fits(4) && data[0] === 0xff && data[1] === 0xd8) {
    let offset = 2;
    while (fits(offset + 9)) {
      if (data[offset] !== 0xff) return null;
      const marker = data[offset + 1]!;
      // Fill bytes, and standalone markers with no length.
      if (marker === 0xff) {
        offset += 1;
        continue;
      }
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        offset += 2;
        continue;
      }
      // SOF0-SOF15, except DHT (C4), JPG (C8) and DAC (CC).
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { width: view.getUint16(offset + 7), height: view.getUint16(offset + 5) };
      }
      offset += 2 + view.getUint16(offset + 2);
    }
  }
  return null;
}
