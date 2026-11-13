import { describe, expect, it } from "vitest";
import { imageFields, readUploadInfo, setUploadInfo } from "@/lib/upload-telemetry";

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

  it("accepts every size id, Compact's included", () => {
    for (const size of ["compact", "smaller", "recommended", "larger"]) {
      const form = new FormData();
      form.set("size_choice", size);
      expect(readUploadInfo(form)).toEqual({ size_choice: size });
    }
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

describe("crop telemetry", () => {
  const encoded = { width: 1, height: 1, quality: 0.8, attempts: 1, rescued: false };
  const full = {
    crop_outcome: "kept",
    crop_level: "apply",
    crop_seen: "1",
    crop_source: "camera",
  };
  const formWith = (fields: Record<string, string>) => {
    const form = new FormData();
    for (const [key, value] of Object.entries(fields)) form.set(key, value);
    return form;
  };

  it("round-trips the crop outcome, level, whether it was seen and the source", () => {
    const form = new FormData();
    setUploadInfo(form, {
      ...encoded,
      crop: { outcome: "adjusted", level: "apply", seen: true, source: "library" },
    });
    expect(readUploadInfo(form).crop).toEqual({
      outcome: "adjusted",
      level: "apply",
      seen: true,
      source: "library",
    });
  });

  it("accepts every outcome, level and source we send, and a photo nobody opened", () => {
    for (const outcome of ["kept", "adjusted", "full_image", "manual", "none"]) {
      expect(readUploadInfo(formWith({ ...full, crop_outcome: outcome })).crop?.outcome).toBe(
        outcome,
      );
    }
    for (const source of ["camera", "camera_app", "library"]) {
      expect(readUploadInfo(formWith({ ...full, crop_source: source })).crop?.source).toBe(source);
    }
    expect(readUploadInfo(formWith({ ...full, crop_seen: "0" })).crop?.seen).toBe(false);
  });

  it("keeps the crop without a source, and drops a source outside the list", () => {
    const noSource: Record<string, string> = { ...full };
    delete noSource.crop_source;
    expect(readUploadInfo(formWith(noSource)).crop).toEqual({
      outcome: "kept",
      level: "apply",
      seen: true,
    });
    expect(readUploadInfo(formWith({ ...full, crop_source: "jane@example.com" })).crop).toEqual({
      outcome: "kept",
      level: "apply",
      seen: true,
    });
  });

  it("drops the whole crop when a value is outside the enumerations", () => {
    expect(
      readUploadInfo(formWith({ ...full, crop_level: "0.1,0.2;0.9,0.9" })).crop,
    ).toBeUndefined();
    expect(
      readUploadInfo(formWith({ ...full, crop_outcome: "jane@example.com" })).crop,
    ).toBeUndefined();
    expect(readUploadInfo(formWith({ ...full, crop_seen: "yes" })).crop).toBeUndefined();
  });

  it("drops the crop when a required half is absent, as from an old client", () => {
    for (const missing of ["crop_outcome", "crop_level", "crop_seen"]) {
      const rest: Record<string, string> = { ...full };
      delete rest[missing!];
      expect(readUploadInfo(formWith(rest)).crop).toBeUndefined();
    }
    expect(readUploadInfo(formWith({})).crop).toBeUndefined();
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
