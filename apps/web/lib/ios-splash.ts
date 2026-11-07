// iOS picks a startup image by exact device size, so every current screen needs its own file.
// `bun run splash:ios` renders the PNGs in public/splash; layout.tsx links them.
// `w` x `h` are portrait CSS points (what iOS reports as device-width and device-height).

export type SplashDevice = { w: number; h: number; dpr: 2 | 3; landscape: boolean };
export type SplashTheme = "dark" | "light";

export const splashThemes: readonly SplashTheme[] = ["dark", "light"];

const iphones: [number, number, 2 | 3][] = [
  [440, 956, 3], // 16 Pro Max
  [402, 874, 3], // 16 Pro
  [430, 932, 3], // 14 and 15 Pro Max, 15 and 16 Plus
  [393, 852, 3], // 14 to 16, 14 and 15 Pro
  [428, 926, 3], // 12 and 13 Pro Max, 14 Plus
  [390, 844, 3], // 12 to 14
  [375, 812, 3], // X, XS, 11 Pro, 12 and 13 mini
  [414, 896, 3], // XS Max, 11 Pro Max
  [414, 896, 2], // XR, 11
  [375, 667, 2], // SE 2 and 3, 8
];

const ipads: [number, number][] = [
  [1032, 1376], // 13 inch
  [834, 1210], // 11 inch M4
  [820, 1180], // 10.9 inch
  [834, 1194], // 11 inch
  [810, 1080], // 10.2 inch
  [834, 1112], // 10.5 inch
  [768, 1024], // 9.7 inch, mini 5
  [744, 1133], // mini 6 and 7
  [1024, 1366], // 12.9 inch
];

export const splashDevices: readonly SplashDevice[] = [
  ...iphones.map(([w, h, dpr]) => ({ w, h, dpr, landscape: false })),
  ...ipads.flatMap(([w, h]) => [
    { w, h, dpr: 2 as const, landscape: false },
    { w, h, dpr: 2 as const, landscape: true },
  ]),
];

/** Pixel size of the PNG, which is also its file name. */
export function splashPixels(d: SplashDevice) {
  const [a, b] = [d.w * d.dpr, d.h * d.dpr];
  return d.landscape ? { width: b, height: a } : { width: a, height: b };
}

export function splashFile(theme: SplashTheme, d: SplashDevice) {
  const { width, height } = splashPixels(d);
  return `${theme}-${width}x${height}.png`;
}

/** Entries for Next's `appleWebApp.startupImage`. */
export const startupImages = splashThemes.flatMap((theme) =>
  splashDevices.map((d) => ({
    url: `/splash/${splashFile(theme, d)}`,
    media: [
      `(device-width: ${d.w}px)`,
      `(device-height: ${d.h}px)`,
      `(-webkit-device-pixel-ratio: ${d.dpr})`,
      `(orientation: ${d.landscape ? "landscape" : "portrait"})`,
      `(prefers-color-scheme: ${theme})`,
    ].join(" and "),
  })),
);
