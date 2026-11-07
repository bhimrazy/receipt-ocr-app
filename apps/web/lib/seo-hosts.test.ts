import { describe, expect, it } from "vitest";
import {
  NOINDEX_VALUE,
  PRODUCTION_HOST,
  buildIsIndexable,
  isProductionHost,
  nonProductionRobotsHeader,
  normalizeHost,
  requestHost,
} from "./seo-hosts";

describe("isProductionHost", () => {
  it("accepts only the production host, ignoring case and port", () => {
    expect(isProductionHost(PRODUCTION_HOST)).toBe(true);
    expect(isProductionHost(`${PRODUCTION_HOST.toUpperCase()}:443`)).toBe(true);
    expect(isProductionHost(`${PRODUCTION_HOST}, other.example`)).toBe(true);
  });

  it.each([
    "preview.receipt-ocr.bhimraj.com.np",
    "preview-receipt-ocr.vercel.app",
    "receiptocr.vercel.app",
    "receipt-abc123-receipt-ocr-workspace.vercel.app",
    `www.${PRODUCTION_HOST}`,
    `${PRODUCTION_HOST}.evil.example`,
    `evil-${PRODUCTION_HOST}`,
    "localhost:3000",
    "",
    null,
    undefined,
  ])("rejects %s", (host) => {
    expect(isProductionHost(host)).toBe(false);
  });

  it("normalizes a trailing dot", () => {
    expect(normalizeHost(`${PRODUCTION_HOST}.`)).toBe(PRODUCTION_HOST);
  });
});

describe("requestHost", () => {
  it("reads Host and ignores a forwarded host", () => {
    const headers = new Headers({ host: "internal", "x-forwarded-host": PRODUCTION_HOST });
    expect(requestHost(headers)).toBe("internal");
    expect(requestHost(new Headers({ host: "a.example" }))).toBe("a.example");
  });
});

describe("nonProductionRobotsHeader", () => {
  const [rule] = nonProductionRobotsHeader.missing;
  const matches = (host: string) => new RegExp(rule!.value).test(host);

  it("sends noindex, nofollow unless the host is production", () => {
    expect(nonProductionRobotsHeader.headers).toEqual([
      { key: "X-Robots-Tag", value: NOINDEX_VALUE },
    ]);
    expect(NOINDEX_VALUE).toBe("noindex, nofollow");
    expect(rule!.type).toBe("host");
  });

  it("the host pattern matches production only (the header is skipped there)", () => {
    expect(matches(PRODUCTION_HOST)).toBe(true);
    expect(matches(`${PRODUCTION_HOST}:3000`)).toBe(true);
    expect(matches("preview.receipt-ocr.bhimraj.com.np")).toBe(false);
    expect(matches(`x${PRODUCTION_HOST}`)).toBe(false);
    expect(matches("receipt-ocr-bhimraj-com-np.vercel.app")).toBe(false);
    expect(matches("localhost")).toBe(false);
  });
});

describe("buildIsIndexable", () => {
  it("is false for Vercel preview and development builds", () => {
    expect(buildIsIndexable({ VERCEL_ENV: "production" })).toBe(true);
    expect(buildIsIndexable({})).toBe(true);
    expect(buildIsIndexable({ VERCEL_ENV: "preview" })).toBe(false);
    expect(buildIsIndexable({ VERCEL_ENV: "development" })).toBe(false);
  });
});
