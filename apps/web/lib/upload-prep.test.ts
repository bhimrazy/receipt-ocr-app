import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MAX_ATTEMPTS,
  MAX_LONG_EDGE,
  PIXEL_BUDGET,
  UPLOAD_LIMIT_BYTES,
  acceptedType,
  encodeToTarget,
  prepareFile,
  CEILING_BYTES,
  HARD_MIN_SHORT_EDGE,
  planSize,
  predictEncode,
  appliedSize,
  largerSize,
  sizeOptions,
  smallerSize,
  TARGET_BYTES,
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
  it("fits a square to the budget", () => {
    expect(planSize(2000, 2000)).toEqual({ width: 1732, height: 1732 });
  });
  it("fits a very large square without passing the long-edge cap", () => {
    const out = planSize(12000, 12000);
    expect(out).toEqual({ width: 1732, height: 1732 });
    expect(area(out)).toBeLessThanOrEqual(PIXEL_BUDGET);
  });
  it("keeps one pixel on a thin strip", () => {
    expect(planSize(1, 20000)).toEqual({ width: 1, height: 6000 });
  });
});

describe("sizeOptions", () => {
  const phone = { width: 3024, height: 4032 };
  const ids = (options: { id: string }[]) => options.map((o) => o.id);

  it("offers Smaller under the automatic size of a phone photo", () => {
    expect(sizeOptions(phone, planSize(3024, 4032))).toEqual([
      { id: "smaller", width: 800, height: 1067 },
      { id: "recommended", width: 1500, height: 2000 },
    ]);
  });
  it("offers Larger when the automatic encode shrinks under 1,200 px for bytes", () => {
    const options = sizeOptions(phone, { width: 1084, height: 1445 });
    expect(ids(options)).toEqual(["smaller", "recommended", "larger"]);
    expect(options[2]).toMatchObject({ width: 1200, height: 1600 });
  });
  it("never offers Larger past the model's pixel budget on a long receipt", () => {
    const source = { width: 1400, height: 4000 };
    expect(largerSize(source)).toBeNull(); // 1200 x 3429 is 4.1 MP
    expect(ids(sizeOptions(source, { width: 1000, height: 2857 }))).toEqual([
      "smaller",
      "recommended",
    ]);
  });
  it("never upscales", () => {
    expect(largerSize({ width: 1200, height: 1500 })).toBeNull();
    expect(smallerSize({ width: 800, height: 3000 })).toBeNull();
    for (const source of [phone, { width: 1250, height: 1600 }, { width: 900, height: 2000 }]) {
      for (const o of sizeOptions(source, planSize(source.width, source.height))) {
        expect(o.width).toBeLessThanOrEqual(source.width);
        expect(o.height).toBeLessThanOrEqual(source.height);
      }
    }
  });
  it("hides an option no different from Recommended", () => {
    // Already 1,200 px or less: Larger would be the same or smaller than what goes anyway.
    const source = { width: 1250, height: 1600 };
    expect(ids(sizeOptions(source, { width: 1250, height: 1600 }))).toEqual([
      "smaller",
      "recommended",
    ]);
    // The rescue pass already took a long receipt down to 800 px, and Larger is past the budget.
    expect(sizeOptions({ width: 1400, height: 4000 }, { width: 800, height: 2286 })).toEqual([]);
  });
  it("never goes under the hard minimum short edge", () => {
    // The long-edge cap would take Smaller to 750 x 6000.
    expect(smallerSize({ width: 1500, height: 12000 })).toBeNull();
  });
  it("offers nothing when fewer than two choices are left", () => {
    expect(sizeOptions({ width: 800, height: 1200 }, { width: 800, height: 1200 })).toEqual([]);
    expect(sizeOptions({ width: 420, height: 891 }, { width: 420, height: 891 })).toEqual([]);
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
    const { encode, calls } = mockEncoder(() => 800_000);
    const out = await encodeToTarget(encode, { width: 1100, height: 4000 });
    // 1100 -> 935 would break the 1,000 px floor, so it stops after the quality steps.
    expect(calls).toHaveLength(3);
    expect(out.attempts).toBe(3);
  });
  it("accepts a source already smaller than the floor without shrinking it", async () => {
    const { encode, calls } = mockEncoder(() => 800_000);
    await encodeToTarget(encode, { width: 600, height: 900 });
    expect(calls).toHaveLength(3);
    expect(calls.every(([w]) => w === 600)).toBe(true);
  });
});

describe("encodeToTarget rescue", () => {
  it("drops to quality 0.5 and scales below the floor when still over the ceiling", async () => {
    // Over the ceiling until the short edge is at most ~900.
    const { encode, calls } = mockEncoder((w, h, q) =>
      Math.min(w, h) <= 900 && q === 0.5 ? 800_000 : 2_000_000,
    );
    const out = await encodeToTarget(encode, { width: 1000, height: 4000 });
    expect(calls.map((c) => c[2])).toEqual([0.85, 0.72, 0.6, 0.5, 0.5]);
    expect(calls[3]![0]).toBe(1000);
    expect(out.width).toBe(850);
    expect(out.blob.size).toBe(800_000);
    expect(out.attempts).toBe(5);
  });
  it("never goes under the hard minimum short edge", async () => {
    const { encode, calls } = mockEncoder(() => 5_000_000);
    await encodeToTarget(encode, { width: 1000, height: 4000 }, { maxAttempts: 20 });
    expect(Math.min(...calls.map(([w, h]) => Math.min(w, h)))).toBeGreaterThanOrEqual(
      HARD_MIN_SHORT_EDGE,
    );
  });
  it("does not rescue a result between the target and the ceiling", async () => {
    const { encode, calls } = mockEncoder(() => CEILING_BYTES - 1);
    await encodeToTarget(encode, { width: 1000, height: 4000 });
    expect(calls).toHaveLength(3);
  });
  it("always makes at least one attempt", async () => {
    const { encode, calls } = mockEncoder(() => 5_000_000);
    await encodeToTarget(encode, size0, { maxAttempts: 0 });
    expect(calls).toHaveLength(1);
  });
});

const size0 = { width: 1000, height: 1000 };

describe("prepareFile size", () => {
  afterEach(() => vi.unstubAllGlobals());
  /** A decoded image of `width` x `height` whose encodes cost `bpp` bytes a pixel at 0.85; records each encode. */
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
          const bytes = Math.round((bpp * this.width * this.height * quality) / 0.85);
          return new Blob([new Uint8Array(bytes)]);
        }
      },
    );
    return encodes;
  }
  const photo = () => new File(["x"], "a.jpg", { type: "image/jpeg" });

  it("encodes Smaller at 800 px", async () => {
    const encodes = stubSized(3024, 4032, 0.2);
    const out = await prepareFile(photo(), "smaller");
    expect(encodes).toEqual([[800, 1067, 0.85]]);
    expect(appliedSize(out)).toBe("smaller");
  });
  it("keeps a chosen size over the target while under the ceiling, stepping only quality", async () => {
    // About 645 KB at 0.6: over the 500 KB target, under 1 MB, so it never shrinks.
    const encodes = stubSized(1400, 4000, 0.5);
    await prepareFile(photo(), "smaller");
    expect(encodes).toEqual([
      [800, 2286, 0.85],
      [800, 2286, 0.72],
      [800, 2286, 0.6],
    ]);
  });
  it("keeps 1,200 px for Larger where the automatic encode shrank under it", async () => {
    // Automatic: 1500 x 2000 shrinks to 1084 x 1445 to reach 500 KB; Larger then keeps 1200 x 1600.
    const encodes = stubSized(3024, 4032, 0.4);
    const out = await prepareFile(photo(), "larger");
    expect(encodes).toContainEqual([1084, 1445, 0.6]);
    expect(encodes.at(-1)).toEqual([1200, 1600, 0.6]);
    expect(appliedSize(out)).toBe("larger");
  });
  it("sends the automatic encode for Larger when that is already over 1,200 px", async () => {
    const encodes = stubSized(3024, 4032, 0.1);
    const out = await prepareFile(photo(), "larger");
    expect(encodes).toEqual([[1500, 2000, 0.85]]);
    expect(appliedSize(out)).toBe("recommended");
  });
  it("still shrinks a chosen size to get under the ceiling", async () => {
    stubSized(3024, 4032, 1);
    const out = await prepareFile(photo(), "larger");
    expect(out.size).toBeLessThanOrEqual(CEILING_BYTES);
  });
  it("uses the automatic plan when the choice doesn't apply, or without one", async () => {
    let encodes = stubSized(800, 1200, 0.1);
    let out = await prepareFile(photo(), "smaller");
    expect(encodes[0]).toEqual([800, 1200, 0.85]);
    expect(appliedSize(out)).toBe("recommended");
    encodes = stubSized(3024, 4032, 0.1);
    out = await prepareFile(photo());
    expect(encodes[0]).toEqual([1500, 2000, 0.85]);
    expect(appliedSize(out)).toBeUndefined();
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
      {
        type: "image/jpeg",
      },
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

describe("predictEncode", () => {
  it("keeps the planned size when the estimate is under the target", async () => {
    const out = await predictEncode({ width: 1000, height: 2000 }, 0.1);
    expect(out).toEqual({ width: 1000, height: 2000, bytes: 200_000 });
  });
  it("shrinks in SCALE_STEP steps like the encoder when over the target", async () => {
    // 0.2 B/px on 3000 x 2000 is 1.2 MB: quality steps alone don't reach 500 KB, two scale steps do.
    const out = await predictEncode({ width: 3000, height: 2000 }, 0.2);
    expect(out).toMatchObject({ width: 2168, height: 1445 });
    expect(out.bytes).toBeLessThanOrEqual(TARGET_BYTES);
  });
  it("keeps a chosen short edge as the floor, so only quality drops", async () => {
    const out = await predictEncode({ width: 1080, height: 3086 }, 0.3, { minShort: 1080 });
    expect(out).toMatchObject({ width: 1080, height: 3086 });
    expect(out.bytes).toBeGreaterThan(TARGET_BYTES);
    expect(out.bytes).toBeLessThanOrEqual(CEILING_BYTES);
  });
});
