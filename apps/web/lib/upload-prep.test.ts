import { describe, expect, it } from "vitest";
import {
  MAX_ATTEMPTS,
  MAX_LONG_EDGE,
  PIXEL_BUDGET,
  UPLOAD_LIMIT_BYTES,
  acceptedType,
  encodeToTarget,
  jpegHasMetadata,
  planSize,
  type Encoder,
} from "./upload-prep";

const area = (s: { width: number; height: number }) => s.width * s.height;

describe("planSize", () => {
  it("fits a phone photo to the pixel budget and keeps the aspect ratio", () => {
    const out = planSize(3024, 4032);
    expect(area(out)).toBeLessThanOrEqual(PIXEL_BUDGET);
    expect(area(out)).toBeGreaterThan(PIXEL_BUDGET * 0.99);
    expect(out.width / out.height).toBeCloseTo(3024 / 4032, 2);
  });
  it("never upscales", () => {
    expect(planSize(800, 1200)).toEqual({ width: 800, height: 1200 });
    expect(planSize(1500, 1500)).toEqual({ width: 1500, height: 1500 });
  });
  it("keeps the short edge at the floor on a tall receipt, past the budget", () => {
    const out = planSize(1200, 5400); // 1:4.5, 6.5 MP
    expect(out.width).toBe(1000);
    expect(out.height).toBe(4500);
    expect(area(out)).toBeGreaterThan(PIXEL_BUDGET);
  });
  it("caps the long edge even if that goes under the floor", () => {
    const out = planSize(1500, 12000);
    expect(out.height).toBe(MAX_LONG_EDGE);
    expect(out.width).toBe(750);
  });
  it("leaves a source with a short edge under the floor at its own width", () => {
    expect(planSize(600, 3000)).toEqual({ width: 600, height: 3000 });
  });
  it("keeps one pixel on a thin strip", () => {
    expect(planSize(1, 20000)).toEqual({ width: 1, height: 6000 });
  });
});

const fakeBlob = (size: number) => ({ size }) as Blob;

/** An encoder whose output size is `bytesAt(width, height, quality)`, recording each call. */
function mockEncoder(bytesAt: (w: number, h: number, q: number) => number) {
  const calls: Array<[number, number, number]> = [];
  const encode: Encoder = async (w, h, q) => {
    calls.push([w, h, q]);
    return fakeBlob(bytesAt(w, h, q));
  };
  return { encode, calls };
}

describe("encodeToTarget", () => {
  const size = { width: 2000, height: 3000 };
  it("stops at the first encode under the target", async () => {
    const { encode, calls } = mockEncoder(() => 100_000);
    const out = await encodeToTarget(encode, size);
    expect(calls).toEqual([[2000, 3000, 0.85]]);
    expect(out.attempts).toBe(1);
  });
  it("steps quality down before scaling", async () => {
    const { encode, calls } = mockEncoder((_w, _h, q) => (q < 0.7 ? 400_000 : 900_000));
    const out = await encodeToTarget(encode, size);
    expect(calls.map((c) => c[2])).toEqual([0.85, 0.72, 0.6]);
    expect(calls.every(([w, h]) => w === 2000 && h === 3000)).toBe(true);
    expect(out.quality).toBe(0.6);
  });
  it("scales down 15% once quality is at the floor", async () => {
    const { encode, calls } = mockEncoder((w) => (w < 1800 ? 300_000 : 900_000));
    const out = await encodeToTarget(encode, size);
    expect(calls[3]).toEqual([1700, 2550, 0.6]);
    expect(out).toMatchObject({ width: 1700, height: 2550, attempts: 4 });
  });
  it("bounds the attempts and returns the smallest encode", async () => {
    const { encode, calls } = mockEncoder((w) => 5_000_000 + w);
    const out = await encodeToTarget(encode, size);
    expect(calls).toHaveLength(MAX_ATTEMPTS);
    expect(out.attempts).toBe(MAX_ATTEMPTS);
    expect(out.blob.size).toBe(Math.min(...calls.map(([w]) => 5_000_000 + w)));
  });
  it("does not scale below the short-edge floor", async () => {
    const { encode, calls } = mockEncoder(() => 5_000_000);
    const out = await encodeToTarget(encode, { width: 1100, height: 4000 });
    // 1100 -> 935 would break the 1,000 px floor, so it stops after the quality steps.
    expect(calls).toHaveLength(3);
    expect(out.attempts).toBe(3);
  });
  it("accepts a source already smaller than the floor without shrinking it", async () => {
    const { encode, calls } = mockEncoder(() => 5_000_000);
    await encodeToTarget(encode, { width: 600, height: 900 });
    expect(calls).toHaveLength(3);
    expect(calls.every(([w]) => w === 600)).toBe(true);
  });
});

describe("jpegHasMetadata", () => {
  const jpeg = (...segments: number[][]) =>
    new Uint8Array([0xff, 0xd8, ...segments.flat(), 0xff, 0xda, 0, 2]);
  it("flags EXIF and IPTC segments", () => {
    expect(jpegHasMetadata(jpeg([0xff, 0xe1, 0, 4, 0, 0]))).toBe(true);
    expect(jpegHasMetadata(jpeg([0xff, 0xed, 0, 4, 0, 0]))).toBe(true);
  });
  it("passes a JPEG with only JFIF and quantisation tables", () => {
    expect(jpegHasMetadata(jpeg([0xff, 0xe0, 0, 4, 0, 0], [0xff, 0xdb, 0, 4, 0, 0]))).toBe(false);
  });
  it("is cautious about anything that is not a JPEG", () => {
    expect(jpegHasMetadata(new Uint8Array([1, 2, 3]))).toBe(true);
  });
});

describe("acceptedType", () => {
  it("accepts photos and PDFs", () => {
    for (const type of ["image/jpeg", "image/png", "image/webp", "image/heic", "application/pdf"]) {
      expect(acceptedType({ name: "x", type })).toBe(type);
    }
  });
  it("falls back to the extension when the browser gives no type", () => {
    expect(acceptedType({ name: "IMG_1.HEIC", type: "" })).toBe("image/heic");
  });
  it("rejects other files, even with a known extension", () => {
    expect(acceptedType({ name: "a.gif", type: "image/gif" })).toBeNull();
    expect(acceptedType({ name: "a.pdf", type: "text/plain" })).toBeNull();
    expect(acceptedType({ name: "notes.txt", type: "" })).toBeNull();
  });
});

describe("UPLOAD_LIMIT_BYTES", () => {
  it("is the deployment body limit, below the app limit", () => {
    expect(UPLOAD_LIMIT_BYTES).toBe(4 * 1024 * 1024);
  });
});
