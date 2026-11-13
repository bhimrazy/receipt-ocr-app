import { afterEach, describe, expect, it, vi } from "vitest";
import { ENCODING, TooLargeError } from "@/lib/upload-encoding";
import {
  LONG_RECEIPT_RATIO,
  MODEL_LONG_EDGE,
  MODEL_MAX_PATCHES,
  SIZE_IDS,
  UPLOAD_LIMIT_BYTES,
  acceptedType,
  chosenOption,
  modelPatches,
  planOption,
  prepareFile,
  uploadInfo,
  uploadPlan,
} from "@/lib/upload-prep";

type Size = { width: number; height: number };
const ids = (options: { id: string }[]) => options.map((o) => o.id);
const dims = (s: Size) => [s.width, s.height];

describe("planOption", () => {
  // The shapes from the sizing review: a 1:1.4 photo, the owner's 1:2.16 receipt, a 1:4 receipt.
  const normal = { width: 3024, height: 4234 };
  const owner = { width: 1400, height: 3028 };
  const long = { width: 1000, height: 4000 };

  it("matches the review's table", () => {
    expect(dims(planOption(owner, "compact"))).toEqual([600, 1298]);
    expect(dims(planOption(owner, "smaller"))).toEqual([800, 1730]);
    expect(dims(planOption(owner, "recommended"))).toEqual([1000, 2163]);
    expect(dims(planOption(owner, "larger"))).toEqual([1191, 2576]);
    expect(dims(planOption(normal, "compact"))).toEqual([655, 917]);
    expect(dims(planOption(normal, "recommended"))).toEqual([1195, 1673]);
    for (const id of ["smaller", "recommended", "larger"] as const)
      expect(dims(planOption(long, id))).toEqual([644, 2576]);
    // Only Compact differs on a long receipt, and the plan sends that at Sharpest anyway.
    expect(dims(planOption(long, "compact"))).toEqual([600, 2400]);
  });
  it("keeps Sharpest inside Claude's patch cap near square", () => {
    const out = planOption({ width: 4000, height: 4000 }, "larger");
    expect(modelPatches(out)).toBeLessThanOrEqual(MODEL_MAX_PATCHES);
    expect(modelPatches({ width: out.width + 28, height: out.height + 28 })).toBeGreaterThan(
      MODEL_MAX_PATCHES,
    );
  });
  it("never upscales", () => {
    expect(planOption({ width: 600, height: 900 }, "larger")).toEqual({ width: 600, height: 900 });
    expect(planOption({ width: 700, height: 1200 }, "recommended")).toEqual({
      width: 700,
      height: 1200,
    });
  });
  it("keeps Standard at least 1,000 px wide up to the long-receipt ratio", () => {
    for (const ratio of [1.5, 2, 2.4, 2.57]) {
      const out = planOption({ width: 2000, height: Math.round(2000 * ratio) }, "recommended");
      expect(out.width).toBeGreaterThanOrEqual(1000);
    }
  });
  it("keeps each option smaller than the next, and Compact at least 600 px wide", () => {
    for (const ratio of [1, 1.33, 2, 2.57]) {
      const source = { width: 3000, height: Math.round(3000 * ratio) };
      const areas = SIZE_IDS.map((id) => planOption(source, id)).map((s) => s.width * s.height);
      for (let i = 1; i < areas.length; i++) expect(areas[i]!).toBeGreaterThan(areas[i - 1]!);
      expect(planOption(source, "compact").width).toBeGreaterThanOrEqual(600);
    }
  });
  it("depends only on the photo's shape", () => {
    // Same shape at two source sizes gives the same output.
    expect(planOption({ width: 3000, height: 6000 }, "recommended")).toEqual(
      planOption({ width: 1500, height: 3000 }, "recommended"),
    );
  });

  it("holds the invariants on random shapes", () => {
    let seed = 42;
    const rand = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    for (let n = 0; n < 500; n++) {
      const source = {
        width: 100 + Math.floor(rand() * 6000),
        height: 100 + Math.floor(rand() * 9000),
      };
      for (const id of SIZE_IDS) {
        const out = planOption(source, id);
        expect(out.width).toBeLessThanOrEqual(source.width);
        expect(out.height).toBeLessThanOrEqual(source.height);
        expect(Math.max(out.width, out.height)).toBeLessThanOrEqual(MODEL_LONG_EDGE);
        expect(modelPatches(out)).toBeLessThanOrEqual(MODEL_MAX_PATCHES);
        // Aspect kept: the short edge is within a pixel of the long edge times the source's ratio.
        const expected =
          (Math.max(out.width, out.height) * Math.min(source.width, source.height)) /
          Math.max(source.width, source.height);
        expect(Math.abs(Math.min(out.width, out.height) - expected)).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe("uploadPlan", () => {
  it("offers all four on a phone photo, smallest first", () => {
    const plan = uploadPlan({ width: 3024, height: 4032 });
    expect(plan.long).toBe(false);
    expect(ids(plan.options)).toEqual(["compact", "smaller", "recommended", "larger"]);
  });
  it("offers each size once", () => {
    // Small and Sharpest would send every pixel, like Standard.
    expect(ids(uploadPlan({ width: 800, height: 1100 }).options)).toEqual([
      "compact",
      "recommended",
    ]);
    // Standard already sends every pixel, so Sharpest would be the same.
    expect(ids(uploadPlan({ width: 950, height: 2400 }).options)).toEqual([
      "compact",
      "smaller",
      "recommended",
    ]);
    // Within Compact's budget nothing is scaled, so there is nothing to choose.
    expect(ids(uploadPlan({ width: 600, height: 900 }).options)).toEqual(["recommended"]);
  });
  it("sends a long receipt at Sharpest with nothing to choose", () => {
    const plan = uploadPlan({ width: 1000, height: Math.ceil(1000 * LONG_RECEIPT_RATIO) + 1 });
    expect(plan.long).toBe(true);
    expect(ids(plan.options)).toEqual(["larger"]);
    expect(plan.options[0]!.height).toBe(MODEL_LONG_EDGE);
    // Turned on its side, it is still long.
    expect(uploadPlan({ width: 4000, height: 1000 }).long).toBe(true);
  });
  it("falls back to Standard, then the only option, for a choice that isn't offered", () => {
    const small = uploadPlan({ width: 800, height: 1100 });
    expect(chosenOption(small, "smaller").id).toBe("recommended");
    expect(chosenOption(small, "compact").id).toBe("compact");
    const long = uploadPlan({ width: 1000, height: 4000 });
    expect(chosenOption(long, "smaller").id).toBe("larger");
    expect(chosenOption(long, "compact").id).toBe("larger");
    expect(chosenOption(uploadPlan({ width: 3024, height: 4032 }), "smaller").id).toBe("smaller");
  });
});

describe("prepareFile size", () => {
  afterEach(() => vi.unstubAllGlobals());
  /** A decoded image whose encodes cost `bpp` bytes a pixel at quality 0.8; records each encode. */
  function stubSized(width: number, height: number, bpp: number) {
    const encodes: Array<[number, number, number]> = [];
    vi.stubGlobal("createImageBitmap", async () => ({ width, height, close() {} }));
    vi.stubGlobal(
      "OffscreenCanvas",
      class {
        constructor(
          public width: number,
          public height: number,
        ) {}
        getContext() {
          return { fillRect() {}, drawImage() {} };
        }
        async convertToBlob({ quality }: { quality: number }) {
          encodes.push([this.width, this.height, quality]);
          const bytes = Math.round((bpp * this.width * this.height * quality) / 0.8);
          return new Blob([new Uint8Array(bytes)], { type: "image/jpeg" });
        }
      },
    );
    return encodes;
  }
  const photo = () => new File(["x"], "a.jpg", { type: "image/jpeg" });

  it("encodes the chosen option once when it lands under the target", async () => {
    const encodes = stubSized(3024, 4032, 0.15);
    const out = await prepareFile(photo(), { size: "smaller", filter: "grey" });
    expect(encodes).toEqual([[866, 1155, 0.8]]);
    expect(uploadInfo(out)).toEqual({
      size: "smaller",
      filter: "grey",
      width: 866,
      height: 1155,
      quality: 0.8,
      attempts: 1,
      rescued: false,
    });
  });
  it("encodes Compact at 600 px wide against its own target", async () => {
    const encodes = stubSized(1400, 3028, 0.5);
    const out = await prepareFile(photo(), { size: "compact" });
    expect(encodes[0]!.slice(0, 2)).toEqual([600, 1298]);
    // 0.5 B/px is about 380 KB at 0.8, over Compact's 350 KB; one step down lands under it.
    expect(encodes.map((e) => e[2])).toEqual([0.8, 0.72]);
    expect(out.size).toBeLessThanOrEqual(ENCODING.targetBytes.compact);
    expect(uploadInfo(out)?.size).toBe("compact");
  });
  it("gives the same size whatever the bytes per pixel", async () => {
    const light = stubSized(1400, 3028, 0.1);
    await prepareFile(photo(), { size: "recommended" });
    const dense = stubSized(1400, 3028, 0.5);
    await prepareFile(photo(), { size: "recommended" });
    expect(light[0]!.slice(0, 2)).toEqual([1000, 2163]);
    expect(new Set(dense.map((e) => `${e[0]}x${e[1]}`))).toEqual(new Set(["1000x2163"]));
  });
  it("steps quality down on a Safari-like 0.49 B/px photo to stay near the target", async () => {
    const encodes = stubSized(1400, 3028, 0.49);
    const out = await prepareFile(photo(), { size: "recommended" });
    expect(encodes.map((e) => e[2])).toEqual([0.8, 0.72, 0.65]);
    expect(out.size).toBeLessThanOrEqual(ENCODING.hardCapBytes);
  });
  it("refuses a photo it can't get under the hard cap", async () => {
    stubSized(3024, 4032, 4);
    await expect(prepareFile(photo(), { size: "larger" })).rejects.toBeInstanceOf(TooLargeError);
  });
  it("uses Standard without a choice, and records no size", async () => {
    const encodes = stubSized(3024, 4032, 0.1);
    const out = await prepareFile(photo());
    expect(encodes[0]!.slice(0, 2)).toEqual([1225, 1633]);
    expect(uploadInfo(out)?.size).toBeUndefined();
  });
  it("returns the original when the canvas hands back another format", async () => {
    vi.stubGlobal("createImageBitmap", async () => ({ width: 100, height: 100, close() {} }));
    vi.stubGlobal(
      "OffscreenCanvas",
      class {
        getContext() {
          return { fillRect() {}, drawImage() {} };
        }
        async convertToBlob() {
          return new Blob(["png"], { type: "image/png" });
        }
      },
    );
    const file = photo();
    expect(await prepareFile(file)).toBe(file);
  });
});

describe("prepareFile metadata", () => {
  afterEach(() => vi.unstubAllGlobals());
  function stubBrowser() {
    vi.stubGlobal("createImageBitmap", async () => ({ width: 100, height: 100, close() {} }));
    vi.stubGlobal(
      "OffscreenCanvas",
      class {
        width = 0;
        height = 0;
        constructor(w: number, h: number) {
          this.width = w;
          this.height = h;
        }
        getContext() {
          return { fillRect() {}, drawImage() {} };
        }
        async convertToBlob() {
          return new Blob(["jpeg"], { type: "image/jpeg" });
        }
      },
    );
  }
  const bytes = (...parts: Array<string | number[]>) =>
    new Uint8Array(
      parts.flatMap((p) => (typeof p === "string" ? [...p].map((c) => c.charCodeAt(0)) : p)),
    );
  it("re-encodes a PNG with an eXIf chunk, even though the original is smaller", async () => {
    stubBrowser();
    const png = new File([bytes([0x89], "PNG", "eXIf", "GPS")], "a.png", { type: "image/png" });
    const out = await prepareFile(png);
    expect(out.type).toBe("image/jpeg");
    expect(out.name).toBe("a.jpg");
  });
  it("re-encodes a JPEG with EXIF and MPF segments", async () => {
    stubBrowser();
    const jpeg = new File(
      [bytes([0xff, 0xd8, 0xff, 0xe1, 0, 8], "Exif", [0xff, 0xe2, 0, 4])],
      "a.jpg",
      { type: "image/jpeg" },
    );
    const out = await prepareFile(jpeg);
    expect(out.type).toBe("image/jpeg");
    expect(await out.text()).toBe("jpeg");
  });
  it("returns the original when the browser can't decode it", async () => {
    vi.stubGlobal("createImageBitmap", async () => {
      throw new Error("no decoder");
    });
    const heic = new File(["heic"], "a.heic", { type: "image/heic" });
    expect(await prepareFile(heic)).toBe(heic);
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
