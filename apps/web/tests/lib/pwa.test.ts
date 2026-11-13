import { describe, expect, it } from "vitest";
import {
  canOffer,
  dismissed,
  iosBrowser,
  isAppPath,
  isIpad,
  markInstalled,
  migrateLegacy,
  parseInstallState,
  shown,
} from "@/lib/pwa";

const UA = {
  iphoneSafari:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
  iphoneChrome:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0.6723.90 Mobile/15E148 Safari/604.1",
  iphoneFirefox:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/132.0 Mobile/15E148 Safari/605.1.15",
  iphoneGoogleApp:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) GSA/340.0.0 Mobile/15E148 Safari/604.1",
  iphoneInstagram:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 350.0",
  ipadOrMac:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15",
  android:
    "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36",
};

describe("iosBrowser", () => {
  it("finds Safari on iPhone and on iPad, which reports a Mac with touch", () => {
    expect(iosBrowser(UA.iphoneSafari, 5)).toBe("safari");
    expect(iosBrowser(UA.ipadOrMac, 5)).toBe("safari");
  });

  it("tells Chrome, other browsers and in-app browsers apart", () => {
    expect(iosBrowser(UA.iphoneChrome, 5)).toBe("chrome");
    expect(iosBrowser(UA.iphoneFirefox, 5)).toBe("other");
    expect(iosBrowser(UA.iphoneGoogleApp, 5)).toBe("other");
    expect(iosBrowser(UA.iphoneInstagram, 5)).toBe("other");
  });

  it("is null off iOS: a Mac without touch and Android", () => {
    expect(iosBrowser(UA.ipadOrMac, 0)).toBeNull();
    expect(iosBrowser(UA.android, 5)).toBeNull();
  });
});

describe("isIpad", () => {
  it("is true for the iPadOS desktop user agent with touch, false for iPhone and Mac", () => {
    expect(isIpad(UA.ipadOrMac, 5)).toBe(true);
    expect(isIpad(UA.ipadOrMac, 0)).toBe(false);
    expect(isIpad(UA.iphoneSafari, 5)).toBe(false);
  });
});

describe("install offer gating", () => {
  const now = new Date("2026-11-08T12:00:00Z");
  const days = (n: number) => new Date(now.getTime() + n * 24 * 60 * 60 * 1000);

  it("offers everywhere until something is dismissed", () => {
    expect(canOffer({}, "app", now)).toBe(true);
    expect(canOffer({}, "landing", now)).toBe(true);
  });

  it("app card: 30 days after the first Not now, for good after the second", () => {
    const once = dismissed({}, "app", now);
    expect(once.app).toEqual({ dismissals: 1, until: days(30).toISOString() });
    expect(canOffer(once, "app", days(29))).toBe(false);
    expect(canOffer(once, "app", days(30))).toBe(true);
    const twice = dismissed(once, "app", days(31));
    expect(twice.app).toEqual({ dismissals: 2, until: null });
    expect(canOffer(twice, "app", days(3650))).toBe(false);
  });

  it("landing sheet: 7 days after Not now, and 3 shows at most", () => {
    const snoozed = dismissed(shown({}, "landing"), "landing", now);
    expect(snoozed.landing).toEqual({ shows: 1, until: days(7).toISOString() });
    expect(canOffer(snoozed, "landing", days(6))).toBe(false);
    expect(canOffer(snoozed, "landing", days(7))).toBe(true);
    const capped = shown(shown(snoozed, "landing"), "landing");
    expect(capped.landing?.shows).toBe(3);
    expect(canOffer({ landing: capped.landing }, "landing", days(365))).toBe(false);
  });

  it("any dismissal, a menu row's declined prompt included, hides every offer for 7 days", () => {
    const fromLanding = dismissed({}, "landing", now);
    expect(canOffer(fromLanding, "app", days(6))).toBe(false);
    expect(canOffer(fromLanding, "app", days(7))).toBe(true);
    const fromMenu = dismissed({}, null, now);
    expect(fromMenu).toEqual({ lastDismissedAt: now.toISOString() });
    expect(canOffer(fromMenu, "landing", days(6))).toBe(false);
    expect(canOffer(fromMenu, "app", days(8))).toBe(true);
  });

  it("offers nothing once installed", () => {
    const state = markInstalled({});
    expect(canOffer(state, "app", days(3650))).toBe(false);
    expect(canOffer(state, "landing", days(3650))).toBe(false);
  });

  it("survives a round trip through storage and drops malformed fields", () => {
    const state = markInstalled(dismissed(shown({}, "landing"), "app", now));
    expect(parseInstallState(JSON.stringify(state))).toEqual(state);
    expect(parseInstallState(null)).toEqual({});
    expect(parseInstallState("not json")).toEqual({});
    expect(parseInstallState('{"app":{"dismissals":"1","until":null}}')).toEqual({});
    expect(parseInstallState('{"landing":{"shows":1,"until":"soon"},"installed":"yes"}')).toEqual(
      {},
    );
  });

  it("migrates the old one-flag dismissal to one app dismissal", () => {
    expect(migrateLegacy("1", now)).toEqual({
      app: { dismissals: 1, until: days(30).toISOString() },
    });
    expect(migrateLegacy("0", now)).toEqual({});
  });
});

describe("isAppPath", () => {
  it("matches /app and below, not look-alikes", () => {
    expect(isAppPath("/app")).toBe(true);
    expect(isAppPath("/app/receipts")).toBe(true);
    expect(isAppPath("/apple")).toBe(false);
  });
});
