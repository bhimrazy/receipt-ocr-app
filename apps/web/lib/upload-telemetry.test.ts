import { describe, expect, it } from "vitest";
import { imageFields, readUploadInfo, setUploadInfo } from "./upload-telemetry";

describe("upload encoding telemetry", () => {
  it("round-trips what the browser recorded", () => {
    const form = new FormData();
    setUploadInfo(form, {
      size: "recommended",
      filter: "grey",
      width: 1000,
      height: 2163,
      quality: 0.72,
      attempts: 2,
      rescued: false,
    });
    expect(readUploadInfo(form)).toEqual({
      size_choice: "recommended",
      encode: { quality: 0.72, attempts: 2, filter: "grey", rescued: false },
    });
  });

  it("drops values outside our own vocabulary", () => {
    const form = new FormData();
    form.set("size_choice", "huge");
    form.set("encode_quality", "0.99");
    form.set("encode_attempts", "1e9");
    form.set("encode_filter", "jane@example.com");
    form.set("encode_rescued", "yes");
    expect(readUploadInfo(form)).toEqual({});
  });

  it("sends nothing for a file the app didn't encode", () => {
    const form = new FormData();
    setUploadInfo(form, undefined);
    expect([...form.keys()]).toEqual([]);
  });
});

describe("imageFields", () => {
  it("reads the size from a PNG header and works out bytes per pixel", () => {
    const png = new Uint8Array(1000);
    png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
    new DataView(png.buffer).setUint32(16, 20);
    new DataView(png.buffer).setUint32(20, 10);
    expect(imageFields(png)).toEqual({ width: 20, height: 10, bytes_per_pixel: 5 });
  });
  it("adds nothing for bytes it can't size", () => {
    expect(imageFields(new TextEncoder().encode("%PDF-1.7"))).toEqual({});
  });
});
