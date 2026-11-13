import { describe, expect, it } from "vitest";
import { imageSize } from "../src/image-size";

const bytes = (...parts: Array<string | number[]>) =>
  new Uint8Array(
    parts.flatMap((part) =>
      typeof part === "string" ? [...part].map((c) => c.charCodeAt(0)) : part,
    ),
  );
const be32 = (n: number) => [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const be16 = (n: number) => [n >> 8, n & 255];
const le16 = (n: number) => [n & 255, n >> 8];

describe("imageSize", () => {
  it("reads PNG's IHDR", () => {
    const png = bytes([0x89], "PNG", [13, 10, 26, 10], be32(13), "IHDR", be32(9000), be32(1200));
    expect(imageSize(png)).toEqual({ width: 9000, height: 1200 });
  });

  it("reads a JPEG's frame header past an APP segment", () => {
    const app0 = [0xff, 0xe0, ...be16(6), 1, 2, 3, 4];
    const sof0 = [0xff, 0xc0, ...be16(17), 8, ...be16(3000), ...be16(8200), 3];
    const jpeg = bytes([0xff, 0xd8], app0, sof0, new Array(12).fill(0));
    expect(imageSize(jpeg)).toEqual({ width: 8200, height: 3000 });
  });

  it("reads GIF and the three WebP chunk kinds", () => {
    expect(imageSize(bytes("GIF89a", le16(640), le16(480)))).toEqual({ width: 640, height: 480 });
    const riff = (chunk: string, body: number[]) =>
      bytes("RIFF", [0, 0, 0, 0], "WEBP", chunk, [0, 0, 0, 0], body);
    // VP8X: 24-bit width-1 and height-1 at offsets 24 and 27.
    const vp8x = riff("VP8X", [0, 0, 0, 0, ...[0x3f, 0x1f, 0], ...[0xff, 0x03, 0], 0, 0]);
    expect(imageSize(vp8x)).toEqual({ width: 8000, height: 1024 });
    // VP8L: signature byte, then 14-bit width-1 and height-1.
    const w = 99;
    const h = 49;
    const bits = w | (h << 14);
    const vp8l = riff("VP8L", [
      0x2f,
      bits & 255,
      (bits >> 8) & 255,
      (bits >> 16) & 255,
      bits >>> 24,
      // Padding: a real VP8L header is followed by image data.
      ...new Array(8).fill(0),
    ]);
    expect(imageSize(vp8l)).toEqual({ width: 100, height: 50 });
    // VP8 (lossy): frame tag, start code, then 14-bit sizes.
    const vp8 = riff("VP8 ", [0, 0, 0, 0x9d, 0x01, 0x2a, ...le16(1920), ...le16(1080)]);
    expect(imageSize(vp8)).toEqual({ width: 1920, height: 1080 });
  });

  it("is null for anything else or a truncated header", () => {
    expect(imageSize(bytes("%PDF-1.7"))).toBeNull();
    expect(imageSize(bytes([0x89], "PNG"))).toBeNull();
    expect(imageSize(bytes([0xff, 0xd8, 0xff, 0xe0]))).toBeNull();
  });
});
