// iOS picks a startup image by exact device size and orientation, so every current screen needs
// its own file. `bun run splash:ios` renders the PNGs in public/splash; layout.tsx links them.
// `w` x `h` are portrait CSS points (what iOS reports as device-width and device-height).

export type SplashOrientation = "portrait" | "landscape";
export type SplashDevice = { w: number; h: number; dpr: 2 | 3; orientation: SplashOrientation };
export type SplashTheme = "dark" | "light";

// One set per OS scheme: iOS picks by the OS scheme, not the in-app choice. iPhones in portrait
// only (the app opens upright); iPads in both, since they are often held sideways.
export const splashThemes: readonly SplashTheme[] = ["dark", "light"];

const iphones: [number, number, 2 | 3][] = [
  [440, 956, 3], // 16 and 17 Pro Max
  [420, 912, 3], // Air
  [402, 874, 3], // 16 Pro, 17 and 17 Pro
  [430, 932, 3], // 14 and 15 Pro Max, 15 and 16 Plus
  [393, 852, 3], // 15, 16, 14 and 15 Pro
  [428, 926, 3], // 12 and 13 Pro Max, 14 Plus
  [390, 844, 3], // 12 to 14, 16e
  [375, 812, 3], // X, XS, 11 Pro, 12 and 13 mini
  [414, 896, 3], // XS Max, 11 Pro Max
  [414, 896, 2], // XR, 11
  [375, 667, 2], // SE 2 and 3, 8
];

// All at 2x.
const ipads: [number, number][] = [
  [1032, 1376], // Pro 13-inch (M4 and later)
  [1024, 1366], // Pro 12.9-inch, Air 13-inch
  [834, 1210], // Pro 11-inch (M4 and later)
  [834, 1194], // Pro 11-inch, Air 11-inch
  [820, 1180], // Air 10.9-inch, iPad 10th generation and later
  [810, 1080], // iPad 10.2-inch
  [744, 1133], // mini 6th generation and later
];

const orientations: readonly SplashOrientation[] = ["portrait", "landscape"];

export const splashDevices: readonly SplashDevice[] = [
  ...iphones.map(([w, h, dpr]): SplashDevice => ({ w, h, dpr, orientation: "portrait" })),
  ...ipads.flatMap(([w, h]) =>
    orientations.map((orientation): SplashDevice => ({ w, h, dpr: 2, orientation })),
  ),
];

/** Pixel size of the PNG as shown (wider than tall in landscape), which is also its file name. */
export function splashPixels(d: SplashDevice) {
  const short = d.w * d.dpr;
  const long = d.h * d.dpr;
  return d.orientation === "portrait"
    ? { width: short, height: long }
    : { width: long, height: short };
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
      `(orientation: ${d.orientation})`,
      `(prefers-color-scheme: ${theme})`,
    ].join(" and "),
  })),
);
