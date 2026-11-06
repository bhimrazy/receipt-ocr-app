import type { Pixels } from "./geometry";

/**
 * Look filters applied to the straightened image, as plain pixel loops (lookup tables and an
 * integral image), so each is a few linear passes. They change pixels in place.
 */
export const FILTERS = ["original", "enhance", "grey", "bw"] as const;
export type Filter = (typeof FILTERS)[number];

export const FILTER_LABELS: Record<Filter, string> = {
  original: "Original",
  enhance: "Enhance",
  grey: "Greyscale",
  bw: "B&W",
};

const luma = (r: number, g: number, b: number) => (77 * r + 150 * g + 29 * b) >> 8;

/** The luma value below which `fraction` of pixels fall. */
export function percentile(hist: Uint32Array, total: number, fraction: number): number {
  const target = total * fraction;
  let seen = 0;
  for (let v = 0; v < 256; v++) {
    seen += hist[v]!;
    if (seen >= target) return v;
  }
  return 255;
}

/** How far toward the paper colour the white point moves: a light white balance, not a full one. */
const WHITE_BALANCE = 0.7;
/** Odd, so the sample doesn't line up with a repeating column pattern. */
const STATS_STEP = 7;

/**
 * Auto levels: the 1st luma percentile becomes black and each channel's paper colour (the
 * mean of the brightest tenth) becomes white, so grey or yellowed paper reads as white.
 */
export function enhance(img: Pixels): Pixels {
  const { data } = img;
  // Statistics from every STATS_STEP-th pixel: the same percentiles at a fraction of the cost.
  const step = STATS_STEP * 4;
  const hist = new Uint32Array(256);
  let total = 0;
  for (let i = 0; i < data.length; i += step) {
    hist[luma(data[i]!, data[i + 1]!, data[i + 2]!)]! += 1;
    total++;
  }
  const lo = percentile(hist, total, 0.01);
  const hi = percentile(hist, total, 0.99);
  const paperCut = percentile(hist, total, 0.9);
  const paper = [0, 0, 0];
  let n = 0;
  for (let i = 0; i < data.length; i += step) {
    if (luma(data[i]!, data[i + 1]!, data[i + 2]!) < paperCut) continue;
    paper[0]! += data[i]!;
    paper[1]! += data[i + 1]!;
    paper[2]! += data[i + 2]!;
    n++;
  }
  if (hi - lo < 8) return img; // flat image: stretching would only amplify noise
  const luts = [0, 1, 2].map((c) => {
    const white = Math.max(lo + 8, hi + ((n ? paper[c]! / n : hi) - hi) * WHITE_BALANCE);
    const lut = new Uint8ClampedArray(256);
    for (let v = 0; v < 256; v++) lut[v] = ((v - lo) * 255) / (white - lo);
    return lut;
  });
  const [r, g, b] = luts as [Uint8ClampedArray, Uint8ClampedArray, Uint8ClampedArray];
  for (let i = 0; i < data.length; i += 4) {
    data[i] = r[data[i]!]!;
    data[i + 1] = g[data[i + 1]!]!;
    data[i + 2] = b[data[i + 2]!]!;
  }
  return img;
}

export function greyscale(img: Pixels): Pixels {
  const { data } = img;
  for (let i = 0; i < data.length; i += 4) {
    data[i] = data[i + 1] = data[i + 2] = luma(data[i]!, data[i + 1]!, data[i + 2]!);
  }
  return img;
}

/** Fraction below the local mean that counts as ink (Bradley-Roth). */
const BW_BIAS = 0.15;

/**
 * Adaptive threshold: a pixel is ink when it is darker than the mean of its window by
 * `BW_BIAS`. The window mean comes from an integral image, so the cost is linear in pixels
 * whatever the window size.
 */
export function blackAndWhite(img: Pixels): Pixels {
  const { data, width, height } = img;
  const grey = new Uint8Array(width * height);
  for (let p = 0, i = 0; p < grey.length; p++, i += 4) {
    grey[p] = luma(data[i]!, data[i + 1]!, data[i + 2]!);
  }
  // Sums of up to 255 x 16.7 M pixels fit in a Uint32.
  const stride = width + 1;
  const integral = new Uint32Array(stride * (height + 1));
  for (let y = 0; y < height; y++) {
    let row = 0;
    for (let x = 0; x < width; x++) {
      row += grey[y * width + x]!;
      integral[(y + 1) * stride + x + 1] = integral[y * stride + x + 1]! + row;
    }
  }
  const half = Math.max(4, Math.round(Math.max(width, height) / 32));
  for (let y = 0; y < height; y++) {
    const y0 = Math.max(0, y - half);
    const y1 = Math.min(height, y + half + 1);
    for (let x = 0; x < width; x++) {
      const x0 = Math.max(0, x - half);
      const x1 = Math.min(width, x + half + 1);
      const sum =
        integral[y1 * stride + x1]! -
        integral[y0 * stride + x1]! -
        integral[y1 * stride + x0]! +
        integral[y0 * stride + x0]!;
      const mean = sum / ((x1 - x0) * (y1 - y0));
      const v = grey[y * width + x]! < mean * (1 - BW_BIAS) ? 0 : 255;
      const i = (y * width + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = v;
    }
  }
  return img;
}

export function applyFilter(img: Pixels, filter: Filter): Pixels {
  switch (filter) {
    case "enhance":
      return enhance(img);
    case "grey":
      return greyscale(img);
    case "bw":
      return blackAndWhite(img);
    default:
      return img;
  }
}

/** Original or Enhance until the accuracy benchmark measures what the others do to OCR. */
export function defaultFilter(remembered: Filter | null, documentFound: boolean): Filter {
  return remembered ?? (documentFound ? "enhance" : "original");
}
