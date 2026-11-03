import { Effect, Exit } from "effect";
import { describe, expect, it } from "vitest";
import { MAX_UPLOAD_BYTES, sniffMediaType, validateUpload } from "./files";

const bytes = (...parts: (number[] | string)[]) =>
  new Uint8Array(
    parts.flatMap((part) =>
      typeof part === "string" ? [...new TextEncoder().encode(part)] : part,
    ),
  );

describe("sniffMediaType (U3)", () => {
  it.each([
    ["image/jpeg", bytes([0xff, 0xd8, 0xff, 0xe1])],
    ["image/png", bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0])],
    ["image/webp", bytes("RIFF", [0, 0, 0, 0], "WEBPVP8 ")],
    ["image/heic", bytes([0, 0, 0, 0x18], "ftypheic", [0, 0, 0, 0])],
    ["image/heif", bytes([0, 0, 0, 0x18], "ftypmif1", [0, 0, 0, 0])],
    ["application/pdf", bytes("%PDF-1.7\n")],
  ])("recognises %s from its magic bytes", (expected, input) => {
    expect(sniffMediaType(input)).toBe(expected);
  });

  it("rejects SVG, HTML and other types whatever the client claims", () => {
    expect(sniffMediaType(bytes("<svg xmlns='http://www.w3.org/2000/svg'>"))).toBeNull();
    expect(sniffMediaType(bytes("<!doctype html>"))).toBeNull();
    expect(sniffMediaType(bytes("GIF89a"))).toBeNull();
    expect(sniffMediaType(bytes([0, 0, 0, 0x18], "ftypisom"))).toBeNull(); // MP4
  });
});

describe("validateUpload", () => {
  const fails = (input: Uint8Array) => Exit.isFailure(Effect.runSyncExit(validateUpload(input)));

  it("rejects empty and oversize files", () => {
    expect(fails(new Uint8Array())).toBe(true);
    const big = new Uint8Array(MAX_UPLOAD_BYTES + 1);
    big.set([0xff, 0xd8, 0xff]);
    expect(fails(big)).toBe(true);
  });

  it("accepts a PDF", () => {
    expect(Effect.runSync(validateUpload(bytes("%PDF-1.4 ...")))).toBe("application/pdf");
  });
});
