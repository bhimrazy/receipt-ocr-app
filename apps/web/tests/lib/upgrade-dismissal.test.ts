import { describe, expect, it } from "vitest";
import {
  bannerDismissed,
  dismiss,
  homeDismissed,
  parseDismissals,
  type Dismissals,
} from "@/lib/upgrade-dismissal";

const DAY = 24 * 60 * 60 * 1000;
const now = Date.parse("2026-11-09T12:00:00Z");
const windows = {
  resetsAt: new Date("2026-12-01T00:00:00Z"),
  opensAt: new Date("2026-11-10T00:00:00Z"),
};

describe("upgrade dismissals", () => {
  it("hides the quiet card for 30 days, then for good after the second Not now", () => {
    const once = dismiss({}, "home", "quiet", windows, now);
    expect(homeDismissed(once, "quiet", now + 29 * DAY)).toBe(true);
    expect(homeDismissed(once, "quiet", now + 31 * DAY)).toBe(false);
    const twice = dismiss(once, "home", "quiet", windows, now + 31 * DAY);
    expect(homeDismissed(twice, "quiet", now + 400 * DAY)).toBe(true);
  });

  it("never lets a quiet dismissal hide near", () => {
    const state = dismiss({}, "home", "quiet", windows, now);
    expect(homeDismissed(state, "near", now + DAY)).toBe(false);
  });

  it("hides the near card until the month resets, keeping the quiet count", () => {
    const quiet = dismiss({}, "home", "quiet", windows, now);
    const near = dismiss(quiet, "home", "near", windows, now + DAY);
    expect(near.home).toEqual({
      quietDismissals: 1,
      until: windows.resetsAt.getTime(),
      level: "near",
    });
    expect(homeDismissed(near, "near", windows.resetsAt.getTime() - 1)).toBe(true);
    expect(homeDismissed(near, "near", windows.resetsAt.getTime())).toBe(false);
  });

  it("never hides the at-limit state", () => {
    const state: Dismissals = { home: { quietDismissals: 5, until: now + DAY, level: "near" } };
    expect(homeDismissed(state, "at", now)).toBe(false);
  });

  it("hides the banner until uploads open again", () => {
    const state = dismiss({}, "banner", "at", windows, now);
    expect(bannerDismissed(state, now)).toBe(true);
    expect(bannerDismissed(state, windows.opensAt.getTime())).toBe(false);
    expect(bannerDismissed({}, now)).toBe(false);
  });

  it("reads a missing, malformed or tampered cookie as nothing dismissed", () => {
    expect(parseDismissals(undefined)).toEqual({});
    expect(parseDismissals("{not json")).toEqual({});
    expect(parseDismissals(JSON.stringify({ home: { quietDismissals: "9" } }))).toEqual({});
    const state = dismiss({}, "banner", "at", windows, now);
    expect(parseDismissals(JSON.stringify(state))).toEqual(state);
  });
});
