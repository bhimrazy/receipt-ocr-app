import { describe, expect, it } from "vitest";
import {
  ENCODING,
  encodeLadder,
  TooLargeError,
  WrongFormatError,
  type Encoder,
} from "./upload-encoding";

const KB = 1024;

/** An encoder whose output is `bytesAt(w, h, q)` bytes of `type`, recording each call. */
function fake(bytesAt: (w: number, h: number, q: number) => number, type = "image/jpeg") {
  const calls: Array<[number, number, number]> = [];
  const encode: Encoder = async (w, h, q) => {
    calls.push([w, h, q]);
    return new Blob([new Uint8Array(bytesAt(w, h, q))], { type });
  };
  return { encode, calls };
}

const standard = { width: 1000, height: 2163 };
const faster = { width: 800, height: 1730 };

describe("ENCODING", () => {
  it("steps quality down and never below the readable floor", () => {
    const q = ENCODING.qualities;
    expect([...q].sort((a, b) => b - a)).toEqual([...q]);
    expect(q.at(-1)).toBe(0.65);
    expect(Math.min(...q, ENCODING.rescueQuality)).toBeGreaterThanOrEqual(0.65);
  });
  it("keeps normal photos at 700 KB or less, and 1.5 MB only as the cap", () => {
    expect(ENCODING.targetBytes.smaller).toBeLessThanOrEqual(ENCODING.targetBytes.recommended);
    expect(ENCODING.targetBytes.recommended).toBe(700 * KB);
    expect(ENCODING.targetBytes.larger).toBeLessThan(ENCODING.hardCapBytes);
    expect(ENCODING.hardCapBytes).toBe(1.5 * 1024 * KB);
  });
  it("encodes JPEG", () => {
    expect(ENCODING.type).toBe("image/jpeg");
  });
});

describe("encodeLadder", () => {
  it("stops at the first quality under the option's target", async () => {
    const { encode, calls } = fake(() => 300 * KB);
    const out = await encodeLadder(encode, standard, "recommended");
    expect(calls).toEqual([[1000, 2163, 0.8]]);
    expect(out).toMatchObject({ ...standard, quality: 0.8, attempts: 1, rescued: false });
    expect(out.blob.size).toBe(300 * KB);
  });

  it("steps down until it lands under the target", async () => {
    const { encode, calls } = fake((_w, _h, q) => (q > 0.7 ? 800 * KB : 600 * KB));
    const out = await encodeLadder(encode, standard, "recommended");
    expect(calls.map((c) => c[2])).toEqual([0.8, 0.72, 0.65]);
    expect(out.quality).toBe(0.65);
  });

  it("uses each option's own target", async () => {
    // 600 KB is under Standard's target but over Compact's.
    const fast = fake(() => 600 * KB);
    await encodeLadder(fast.encode, faster, "smaller");
    expect(fast.calls).toHaveLength(3);
    const std = fake(() => 600 * KB);
    await encodeLadder(std.encode, standard, "recommended");
    expect(std.calls).toHaveLength(1);
  });

  it("sends the smallest ladder step when it is over the target but under the cap", async () => {
    const { encode, calls } = fake((_w, _h, q) => Math.round(1600 * KB * q));
    const out = await encodeLadder(encode, { width: 1191, height: 2576 }, "larger", faster);
    expect(calls).toHaveLength(3);
    expect(out).toMatchObject({ quality: 0.65, rescued: false, width: 1191 });
    expect(out.blob.size).toBeLessThanOrEqual(ENCODING.hardCapBytes);
  });

  it("re-encodes once at the rescue size when every step is over the cap", async () => {
    const { encode, calls } = fake((w) => (w > 800 ? 2000 * KB : 900 * KB));
    const out = await encodeLadder(encode, standard, "recommended", faster);
    expect(calls.at(-1)).toEqual([800, 1730, ENCODING.rescueQuality]);
    expect(out).toMatchObject({ ...faster, rescued: true, attempts: 4 });
  });

  it("refuses a photo still over the cap after the rescue", async () => {
    const { encode } = fake(() => 2000 * KB);
    await expect(encodeLadder(encode, standard, "recommended", faster)).rejects.toBeInstanceOf(
      TooLargeError,
    );
  });

  it("skips a rescue that is not smaller and refuses", async () => {
    const { encode, calls } = fake(() => 2000 * KB);
    await expect(encodeLadder(encode, faster, "smaller", faster)).rejects.toThrow(TooLargeError);
    expect(calls).toHaveLength(3);
  });

  it("treats a non-JPEG result as a failure (Safari's silent PNG)", async () => {
    const { encode } = fake(() => 100, "image/png");
    await expect(encodeLadder(encode, standard, "recommended")).rejects.toBeInstanceOf(
      WrongFormatError,
    );
  });
});
