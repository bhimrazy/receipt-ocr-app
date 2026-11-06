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

  it("lets the app register its own service worker and manifest, nothing else", () => {
    const csp = buildContentSecurityPolicy(undefined);
    expect(directive(csp, "worker-src")).toBe("worker-src 'self'");
    expect(directive(csp, "manifest-src")).toBe("manifest-src 'self'");
  });
});
