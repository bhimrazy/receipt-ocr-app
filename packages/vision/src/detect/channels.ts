import type { Pixels } from "../geometry";

/** Long edge, in pixels, of the image the detector works on. */
export const DETECT_EDGE = 256;

export type Grey = { data: Uint8Array; width: number; height: number };

/** Area-averaged luma at a long edge of at most `edge` px. */
export function toSmallLuma(src: Pixels, edge = DETECT_EDGE): Grey {
  const scale = Math.min(1, edge / Math.max(src.width, src.height));
  const width = Math.max(1, Math.round(src.width * scale));
  const height = Math.max(1, Math.round(src.height * scale));
  const sum = new Float64Array(width * height);
  const count = new Uint32Array(width * height);
  const { data } = src;
  for (let y = 0; y < src.height; y++) {
    const ty = Math.min(height - 1, Math.floor(y * scale)) * width;
    for (let x = 0; x < src.width; x++) {
      const i = (y * src.width + x) * 4;
      const t = ty + Math.min(width - 1, Math.floor(x * scale));
      sum[t]! += 0.299 * data[i]! + 0.587 * data[i + 1]! + 0.114 * data[i + 2]!;
      count[t]! += 1;
    }
  }
  const out = new Uint8Array(width * height);
  for (let i = 0; i < out.length; i++) out[i] = count[i] ? sum[i]! / count[i]! : 0;
  return { data: out, width, height };
}

/** 3x3 box blur, edges clamped. */
export function blur({ data, width, height }: Grey): Grey {
  const out = new Uint8Array(data.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let s = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = Math.min(height - 1, Math.max(0, y + dy)) * width;
        for (let dx = -1; dx <= 1; dx++) s += data[yy + Math.min(width - 1, Math.max(0, x + dx))]!;
      }
      out[y * width + x] = s / 9;
    }
  }
  return { data: out, width, height };
}

/** The threshold that best splits the histogram into two classes. */
export function otsu(data: Uint8Array): number {
  const hist = new Float64Array(256);
  for (const v of data) hist[v]! += 1;
  const total = data.length;
  let sumAll = 0;
  for (let i = 0; i < 256; i++) sumAll += i * hist[i]!;
  let sumB = 0;
  let wB = 0;
  let best = 0;
  let threshold = 127;
  for (let t = 0; t < 256; t++) {
    wB += hist[t]!;
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * hist[t]!;
    const mB = sumB / wB;
    const mF = (sumAll - sumB) / wF;
    const between = wB * wF * (mB - mF) ** 2;
    if (between > best) {
      best = between;
      threshold = t;
    }
  }
  return threshold;
}
