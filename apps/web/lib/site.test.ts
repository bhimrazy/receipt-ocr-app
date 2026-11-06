import { describe, expect, it } from "vitest";
import { resolveSiteUrl } from "./site";

describe("resolveSiteUrl", () => {
  it("prefers NEXT_PUBLIC_SITE_URL", () => {
    expect(
      resolveSiteUrl({
        NEXT_PUBLIC_SITE_URL: "https://a.example",
        VERCEL_PROJECT_PRODUCTION_URL: "b.example",
      }),
    ).toEqual({ url: "https://a.example", isFallback: false });
  });

  it("uses the Vercel production host when no explicit URL is set", () => {
    expect(resolveSiteUrl({ VERCEL_PROJECT_PRODUCTION_URL: "b.example" })).toEqual({
      url: "https://b.example",
      isFallback: false,
    });
  });

  it("flags the localhost fallback when neither is set", () => {
    expect(resolveSiteUrl({})).toEqual({ url: "http://localhost:3000", isFallback: true });
  });
});
