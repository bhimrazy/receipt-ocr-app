import { describe, expect, it } from "vitest";
import { isAppPath, isIosSafari } from "./pwa";

const UA = {
  iphoneSafari:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
  iphoneChrome:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0.6723.90 Mobile/15E148 Safari/604.1",
  iphoneInApp:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 350.0",
  ipadOrMac:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15",
  android:
    "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36",
};

describe("isIosSafari", () => {
  it("is true for Safari on iPhone and on iPad (which reports a Mac with touch)", () => {
    expect(isIosSafari(UA.iphoneSafari, 5)).toBe(true);
    expect(isIosSafari(UA.ipadOrMac, 5)).toBe(true);
  });

  it("is false for desktop Safari, other iOS browsers, in-app browsers and Android", () => {
    expect(isIosSafari(UA.ipadOrMac, 0)).toBe(false);
    expect(isIosSafari(UA.iphoneChrome, 5)).toBe(false);
    expect(isIosSafari(UA.iphoneInApp, 5)).toBe(false);
    expect(isIosSafari(UA.android, 5)).toBe(false);
  });
});

describe("isAppPath", () => {
  it("matches /app and below, not look-alikes", () => {
    expect(isAppPath("/app")).toBe(true);
    expect(isAppPath("/app/history")).toBe(true);
    expect(isAppPath("/apple")).toBe(false);
    expect(isAppPath("/landing-a")).toBe(false);
  });
});
