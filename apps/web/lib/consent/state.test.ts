import { describe, expect, it } from "vitest";
import {
  CONSENT_MAX_AGE_SECONDS,
  CONSENT_VERSION,
  isAnalyticsPath,
  parseGaMeasurementId,
  stripUrl,
} from "./config";
import {
  ACCEPT_ALL,
  REJECT_ALL,
  allowedTools,
  makeRecord,
  needsBanner,
  parseConsent,
  readSignals,
  serializeConsent,
} from "./state";

const now = 1_800_000_000;
const both = { googleAnalytics: true, pageCounts: true };
const none = { gpc: false, dnt: false };

describe("consent record", () => {
  it("round-trips through the cookie value", () => {
    const record = makeRecord({ analytics: true, marketing: false, pageCounts: false }, now);
    expect(parseConsent(serializeConsent(record), now)).toEqual(record);
  });

  it("asks again when the policy version changes", () => {
    const value = serializeConsent({
      ...makeRecord(ACCEPT_ALL, now),
      version: CONSENT_VERSION + 1,
    });
    expect(parseConsent(value, now)).toBeNull();
  });

  it("expires after 12 months and refuses future dates", () => {
    const value = serializeConsent(makeRecord(ACCEPT_ALL, now));
    expect(parseConsent(value, now + CONSENT_MAX_AGE_SECONDS)).not.toBeNull();
    expect(parseConsent(value, now + CONSENT_MAX_AGE_SECONDS + 1)).toBeNull();
    expect(parseConsent(value, now - 2 * 86_400)).toBeNull();
  });

  it("treats missing or malformed values as no choice", () => {
    for (const raw of [
      undefined,
      "",
      "garbage",
      "v=1&ts=1800000000&analytics=yes&marketing=0&pagecounts=1",
      "v=1&analytics=1&marketing=0&pagecounts=1",
    ]) {
      expect(parseConsent(raw, now)).toBeNull();
    }
  });
});

describe("what may run", () => {
  it("keeps GA off until the visitor accepts, and page counts on until they object", () => {
    expect(allowedTools(null, none, both)).toEqual({ googleAnalytics: false, pageCounts: true });
    expect(allowedTools(makeRecord(ACCEPT_ALL, now), none, both)).toEqual({
      googleAnalytics: true,
      pageCounts: true,
    });
    expect(allowedTools(makeRecord(REJECT_ALL, now), none, both)).toEqual({
      googleAnalytics: false,
      pageCounts: false,
    });
  });

  it("never runs a tool the build doesn't configure", () => {
    const accepted = makeRecord(ACCEPT_ALL, now);
    expect(allowedTools(accepted, none, { googleAnalytics: false, pageCounts: false })).toEqual({
      googleAnalytics: false,
      pageCounts: false,
    });
  });

  it("treats Global Privacy Control as a reject for GA, even after an accept", () => {
    const signals = readSignals({ globalPrivacyControl: true });
    expect(signals).toEqual({ gpc: true, dnt: false });
    expect(allowedTools(makeRecord(ACCEPT_ALL, now), signals, both)).toEqual({
      googleAnalytics: false,
      pageCounts: true,
    });
    expect(needsBanner(null, signals, both)).toBe(false);
  });

  it("treats Do Not Track as a reject for all measurement", () => {
    const signals = readSignals({ doNotTrack: "1" });
    expect(allowedTools(makeRecord(ACCEPT_ALL, now), signals, both)).toEqual({
      googleAnalytics: false,
      pageCounts: false,
    });
    expect(needsBanner(null, signals, both)).toBe(false);
    // Only a strict true / "1" counts.
    expect(readSignals({ globalPrivacyControl: "true", doNotTrack: "0" })).toEqual(none);
  });

  it("shows the banner only when GA is configured and unanswered", () => {
    expect(needsBanner(null, none, both)).toBe(true);
    expect(needsBanner(null, none, { googleAnalytics: false, pageCounts: true })).toBe(false);
    expect(needsBanner(makeRecord(REJECT_ALL, now), none, both)).toBe(false);
  });
});

describe("config", () => {
  it("allows analytics on public pages only", () => {
    for (const path of ["/", "/privacy", "/terms", "/cookies", "/sign-in", "/sign-up"]) {
      expect(isAnalyticsPath(path)).toBe(true);
    }
    for (const path of [
      "/app",
      "/app/receipts/123",
      "/admin",
      "/reset-password",
      "/accept-invitation/abc",
      "/sign-in/x",
    ]) {
      expect(isAnalyticsPath(path)).toBe(false);
    }
  });

  it("accepts only GA4 measurement ids", () => {
    expect(parseGaMeasurementId(" G-ABC123XYZ9 ")).toBe("G-ABC123XYZ9");
    for (const raw of [undefined, "", "UA-1234-1", "g-abc123", "G-ABC123;alert(1)", "phc_secret"]) {
      expect(parseGaMeasurementId(raw)).toBeUndefined();
    }
  });

  it("strips query strings and fragments from URLs", () => {
    expect(stripUrl("https://x.test/sign-in?redirect=/app/receipts/1#a")).toBe(
      "https://x.test/sign-in",
    );
    expect(stripUrl("not a url")).toBe("");
  });
});
