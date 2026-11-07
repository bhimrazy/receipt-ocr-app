import { describe, expect, it } from "vitest";
import { buildContentSecurityPolicy } from "./csp";

const directive = (csp: string, name: string) =>
  csp.split("; ").find((part) => part.startsWith(`${name} `));

describe("buildContentSecurityPolicy", () => {
  it("allows Cloudflare challenges in script and frame sources when Turnstile is on", () => {
    const csp = buildContentSecurityPolicy("0x4AAA");
    expect(directive(csp, "script-src")).toContain("https://challenges.cloudflare.com");
    expect(directive(csp, "frame-src")).toContain("https://challenges.cloudflare.com");
    expect(csp).toContain("report-uri /api/csp-report");
  });

  it("leaves Cloudflare out when the site key is unset or blank", () => {
    for (const key of [undefined, "", "  "]) {
      expect(buildContentSecurityPolicy(key)).not.toContain("cloudflare.com");
    }
  });

  it("adds Google Analytics origins only when GA is on", () => {
    const off = buildContentSecurityPolicy(undefined);
    expect(off).not.toMatch(/google/);
    expect(directive(off, "connect-src")).toBe("connect-src 'self'");

    const on = buildContentSecurityPolicy(undefined, { googleAnalytics: true });
    expect(directive(on, "script-src")).toContain("https://www.googletagmanager.com");
    expect(directive(on, "connect-src")).toContain("https://*.google-analytics.com");
    expect(directive(on, "connect-src")).toContain("https://*.analytics.google.com");
    // GA4 without ads features: no doubleclick or ad-serving origins.
    expect(on).not.toMatch(/doubleclick|googlesyndication|googleadservices/);
  });
});
