import { afterEach, describe, expect, it, vi } from "vitest";
import { deleteGaCookies, gtagPageView, initGtag } from "./gtag";

function stubBrowser(cookie: string, hostname = "app.example.com") {
  const written: string[] = [];
  const doc = {
    referrer: "https://app.example.com/sign-in?redirect=/app/receipts/abc",
    title: "Sign in",
    get cookie() {
      return cookie;
    },
    set cookie(value: string) {
      written.push(value);
    },
  };
  const calls: unknown[][] = [];
  const win = { gtag: (...args: unknown[]) => calls.push(args) };
  vi.stubGlobal("document", doc);
  vi.stubGlobal("window", win);
  vi.stubGlobal("location", { hostname, origin: `https://${hostname}`, pathname: "/sign-in" });
  return { written, calls };
}

afterEach(() => vi.unstubAllGlobals());

describe("deleteGaCookies", () => {
  it("expires _ga and _ga_<id> host-only and on the host, never on a parent domain", () => {
    const { written } = stubBrowser("consent=x; _ga=GA1.1.1; _ga_ABC123=GS1; session=y");
    deleteGaCookies();
    expect(written).toContain("_ga=; Path=/; Max-Age=0");
    expect(written).toContain("_ga=; Path=/; Max-Age=0; Domain=app.example.com");
    expect(written).toContain("_ga_ABC123=; Path=/; Max-Age=0; Domain=app.example.com");
    expect(written.some((c) => c.includes("Domain=.") || c.includes("Domain=example.com"))).toBe(
      false,
    );
    expect(written.some((c) => c.startsWith("consent=") || c.startsWith("session="))).toBe(false);
  });

  it("does nothing without GA cookies", () => {
    const { written } = stubBrowser("consent=x");
    deleteGaCookies();
    expect(written).toEqual([]);
  });
});

describe("initGtag", () => {
  it("keeps _ga on this host so a rejection can't touch a shared parent domain", () => {
    const { calls } = stubBrowser("");
    initGtag("G-TEST123456");
    const config = calls.find((c) => c[0] === "config");
    expect((config![2] as { cookie_domain: string }).cookie_domain).toBe("app.example.com");
  });
});

describe("gtagPageView", () => {
  it("sets a stripped page_location and referrer before the event, so later hits inherit them", () => {
    const { calls } = stubBrowser("");
    gtagPageView("/sign-in");
    const stripped = {
      page_location: "https://app.example.com/sign-in",
      page_referrer: "https://app.example.com/sign-in",
    };
    expect(calls[0]).toEqual(["set", stripped]);
    expect(calls[1]).toEqual(["event", "page_view", { ...stripped, page_title: "Sign in" }]);
    expect(JSON.stringify(calls)).not.toContain("?");
  });
});
