// Install-dialog screenshots for the web app manifest, made from test data by
// `bun run screenshots:manifest` (scripts/manifest-screenshots.ts) into public/screenshots.
// Chrome on Android shows its richer install dialog only with a `narrow` one; desktop uses `wide`.

export type ManifestScreen = "home" | "receipt";

export type ManifestScreenshot = {
  screen: ManifestScreen;
  formFactor: "narrow" | "wide";
  /** CSS pixels and device pixel ratio the page is captured at. */
  width: number;
  height: number;
  dpr: 1 | 2;
  label: string;
};

export const manifestScreenshots: readonly ManifestScreenshot[] = [
  {
    screen: "home",
    formFactor: "narrow",
    width: 390,
    height: 844,
    dpr: 2,
    label: "Home: add receipts and see which ones to check",
  },
  {
    screen: "receipt",
    formFactor: "narrow",
    width: 390,
    height: 844,
    dpr: 2,
    label: "A scanned receipt next to its photo",
  },
  {
    screen: "home",
    formFactor: "wide",
    width: 1440,
    height: 900,
    dpr: 1,
    label: "Home on a computer, with this month's spending",
  },
];

/** Pixel size of the PNG. */
export function screenshotPixels(s: ManifestScreenshot) {
  return { width: s.width * s.dpr, height: s.height * s.dpr };
}

export function screenshotFile(s: ManifestScreenshot) {
  return `${s.screen}-${s.formFactor}.png`;
}

/** Entries for the manifest's `screenshots`. */
export function manifestScreenshotEntries() {
  return manifestScreenshots.map((s) => {
    const { width, height } = screenshotPixels(s);
    return {
      src: `/screenshots/${screenshotFile(s)}`,
      sizes: `${width}x${height}`,
      type: "image/png",
      form_factor: s.formFactor,
      label: s.label,
    };
  });
}
