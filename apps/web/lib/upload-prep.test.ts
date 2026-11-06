import { describe, expect, it } from "vitest";
import {
  KEEP_ORIGINAL_BYTES,
  UPLOAD_LIMIT_BYTES,
  acceptedType,
  fitWithin,
  shouldReencode,
} from "./upload-prep";

describe("fitWithin", () => {
  it("scales the long edge to the cap and keeps the aspect ratio", () => {
    expect(fitWithin(3024, 4032)).toEqual({ width: 1500, height: 2000 });
    expect(fitWithin(4032, 3024)).toEqual({ width: 2000, height: 1500 });
  });
  it("never upscales", () => {
    expect(fitWithin(800, 1200)).toEqual({ width: 800, height: 1200 });
  });
  it("keeps at least one pixel on a very thin strip", () => {
    expect(fitWithin(1, 20000)).toEqual({ width: 1, height: 2000 });
  });
});

describe("shouldReencode", () => {
  const small = { type: "image/jpeg", size: KEEP_ORIGINAL_BYTES, width: 1200, height: 1600 };
  it("keeps a small in-bounds photo", () => expect(shouldReencode(small)).toBe(false));
  it("re-encodes when too many pixels", () =>
    expect(shouldReencode({ ...small, height: 2001 })).toBe(true));
  it("re-encodes when too many bytes", () =>
    expect(shouldReencode({ ...small, size: KEEP_ORIGINAL_BYTES + 1 })).toBe(true));
  it("always converts HEIC", () =>
    expect(shouldReencode({ ...small, type: "image/heic" })).toBe(true));
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
    expect(UPLOAD_LIMIT_BYTES).toBe(4_400_000);
  });
});
