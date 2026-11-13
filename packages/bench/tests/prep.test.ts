import sharp, { type Sharp } from "sharp";
import { describe, expect, it } from "vitest";
import { imageSize } from "../../ai/src/image-size";
import { imageTokens, parsePrep, prepare, prepLabel, scaleFor } from "../prep";

const image = async (width: number, height: number, format: "png" | "webp" = "png") =>
  new Uint8Array(
    await sharp({ create: { width, height, channels: 3, background: "#ccc" } })
      [format]()
      .toBuffer(),
  );

const sizeOf = async (data: Uint8Array) => {
  const { width, height, format } = await sharp(data).metadata();
  return { width, height, format };
};

describe("parsePrep", () => {
  it("reads every mode and round-trips its label", () => {
    for (const spec of ["none", "app", "long:1568", "short:1000", "short:1000/2576"]) {
      expect(prepLabel(parsePrep(spec))).toBe(spec);
    }
  });

  it("rejects unknown modes and silly sizes", () => {
    expect(() => parsePrep("tiny")).toThrow(/unknown --prep/);
    expect(() => parsePrep("long:abc")).toThrow(/whole number/);
    expect(() => parsePrep("long:20")).toThrow(/whole number/);
  });
});

describe("scaleFor", () => {
  it("caps the long edge, and never upscales", () => {
    expect(scaleFor(parsePrep("long:1000"), 4000, 1000)).toBe(0.25);
    expect(scaleFor(parsePrep("long:4000"), 1000, 500)).toBe(1);
  });

  it("brings the short edge down to px, within the long-edge cap", () => {
    // A tall 1:6 receipt: 1200 x 7200. short:1000 keeps it readable at 1000 x 6000.
    expect(scaleFor(parsePrep("short:1000"), 1200, 7200)).toBeCloseTo(1000 / 1200);
    // With a 2576 long-edge cap, the long edge wins.
    expect(scaleFor(parsePrep("short:1000/2576"), 1200, 7200)).toBeCloseTo(2576 / 7200);
    // Never upscaled: a short edge already under px stays as it is.
    expect(scaleFor(parsePrep("short:2000"), 1200, 3000)).toBe(1);
  });
});

describe("prepare", () => {
  it("sends the file untouched for none, with its size", async () => {
    const data = await image(300, 200, "webp");
    const out = await prepare(data, "image/webp", parsePrep("none"));
    expect(out.data).toBe(data);
    expect(out).toMatchObject({ mediaType: "image/webp", width: 300, height: 200, applied: true });
  });

  it("resizes and re-encodes as JPEG for long:", async () => {
    const out = await prepare(await image(2000, 1000), "image/png", parsePrep("long:1000"));
    expect(out).toMatchObject({ mediaType: "image/jpeg", width: 1000, height: 500 });
    expect(await sizeOf(out.data)).toEqual({ width: 1000, height: 500, format: "jpeg" });
  });

  it("applies the app's Standard size for app", async () => {
    // 4000 x 3000 = 12 MP; Standard's 2 MP budget gives 1633 x 1225.
    const out = await prepare(await image(4000, 3000), "image/png", parsePrep("app"));
    expect(out).toMatchObject({ mediaType: "image/jpeg", width: 1633, height: 1225 });
    expect(await sizeOf(out.data)).toMatchObject({ width: 1633, height: 1225, format: "jpeg" });
  });

  it("sends a PDF as is under every mode, marking the mode as not applied", async () => {
    const pdf = new TextEncoder().encode("%PDF-1.7");
    const out = await prepare(pdf, "application/pdf", parsePrep("long:1000"));
    expect(out).toEqual({
      data: pdf,
      mediaType: "application/pdf",
      width: null,
      height: null,
      applied: false,
    });
  });
});

describe("imageTokens", () => {
  it("counts Groq images at its documented flat 2048 tokens", () => {
    expect(imageTokens("groq", 1000, 1000)).toBe(2048);
  });

  it("counts OpenAI images as 32 px patches within a 2048 px side and 2,500 patches", () => {
    expect(imageTokens("openai", 1024, 1024)).toBe(1024);
    expect(imageTokens("openai", 4000, 3000)).toBeLessThanOrEqual(2500);
    expect(imageTokens("openai", 4000, 3000)).toBeGreaterThan(2000);
  });

  it("matches the Claude high-resolution examples in the vision docs", () => {
    expect(imageTokens("anthropic", 1000, 1000)).toBe(1296);
    expect(imageTokens("anthropic", 1920, 1080)).toBe(2691);
    // 3840 x 2160 is scaled down to the 4784-token cap.
    expect(imageTokens("anthropic", 3840, 2160)).toBeLessThanOrEqual(4784);
    expect(imageTokens("anthropic", 3840, 2160)).toBeGreaterThan(4600);
  });

  it("is Gemini's fixed per-image budget, and unknown for a PDF on Claude", () => {
    expect(imageTokens("google", 4000, 3000)).toBe(1120);
    expect(imageTokens("anthropic", null, null)).toBeNull();
  });
});

describe("packages/ai imageSize against real encodes", () => {
  it.each([
    ["png", (s: Sharp) => s.png()],
    ["jpeg", (s: Sharp) => s.jpeg()],
    ["progressive jpeg", (s: Sharp) => s.jpeg({ progressive: true })],
    ["lossy webp", (s: Sharp) => s.webp()],
    ["lossless webp", (s: Sharp) => s.webp({ lossless: true })],
    ["gif", (s: Sharp) => s.gif()],
  ])("reads %s", async (_, encode) => {
    const source = sharp({ create: { width: 321, height: 123, channels: 3, background: "#888" } });
    const data = new Uint8Array(await encode(source).toBuffer());
    expect(imageSize(data)).toEqual({ width: 321, height: 123 });
  });
});
