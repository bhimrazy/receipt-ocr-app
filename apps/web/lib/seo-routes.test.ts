import { describe, expect, it } from "vitest";
import nextConfig from "../next.config";
import { robotsFor } from "@/app/robots";
import sitemap from "@/app/sitemap";
import { llmsFullTxt, llmsResponse, llmsTxt } from "@/lib/llms";
import { homeDescription, homeJsonLd, homeTitle, jsonLdScript } from "@/lib/seo";
import { PRODUCTION_HOST, PRODUCTION_ORIGIN } from "@/lib/seo-hosts";

const req = (host: string) => new Request("http://internal/llms.txt", { headers: { host } });

describe("robots.txt per host", () => {
  const blocked = [
    "preview.receipt-ocr.bhimraj.com.np",
    "preview-receipt-ocr.vercel.app",
    "receiptocr.vercel.app",
    "receipt-x1-receipt-ocr-workspace.vercel.app",
    "localhost:3000",
    "",
  ];
  it.each(blocked)("disallows everything on %s and lists no sitemap", (host) => {
    expect(robotsFor(host)).toEqual({ rules: { userAgent: "*", disallow: "/" } });
  });

  it("allows public pages on production, blocks protected routes, names the sitemap", () => {
    const robots = robotsFor(PRODUCTION_HOST);
    expect(robots.sitemap).toBe(`${PRODUCTION_ORIGIN}/sitemap.xml`);
    const rules = robots.rules as { allow: string; disallow: string[] };
    expect(rules.allow).toBe("/");
    for (const path of [
      "/api/",
      "/app/",
      "/admin/",
      "/accept-invitation",
      "/account-deleted",
      "/offline.html",
    ]) {
      expect(rules.disallow, path).toContain(path);
    }
    // Crawlable so their noindex can be read.
    for (const path of ["/sign-in", "/sign-up", "/forgot-password"]) {
      expect(rules.disallow, path).not.toContain(path);
    }
    // "/app" as a bare prefix would also block /apple-icon.png.
    expect(rules.disallow).not.toContain("/app");
    for (const path of ["/", "/privacy", "/terms", "/cookies", "/llms.txt"]) {
      expect(
        rules.disallow.some((rule) => path.startsWith(rule)),
        path,
      ).toBe(false);
    }
  });
});

describe("sitemap", () => {
  it("lists only the public prod pages, each with lastModified", () => {
    const entries = sitemap();
    expect(entries.map((e) => e.url)).toEqual(
      ["/", "/privacy", "/terms", "/cookies"].map((p) => new URL(p, PRODUCTION_ORIGIN).toString()),
    );
    for (const entry of entries) expect(entry.lastModified, entry.url).toBeTruthy();
    expect(entries.some((e) => /\/(app|admin|api|sign-|landing-|final-)/.test(e.url))).toBe(false);
  });
});

describe("llms.txt host gating", () => {
  it("serves text on production", async () => {
    const res = llmsResponse(req(PRODUCTION_HOST), llmsTxt);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/plain");
    const body = await res.text();
    expect(body).toMatch(/^# ReceiptOCR/);
    expect(body).toContain(`${PRODUCTION_ORIGIN}/privacy`);
    expect(body).toContain("https://github.com/bhimrazy/receipt-ocr");
  });

  it.each(["preview.receipt-ocr.bhimraj.com.np", "receiptocr.vercel.app", "localhost:3000"])(
    "404s on %s",
    async (host) => {
      const res = llmsResponse(req(host), llmsFullTxt);
      expect(res.status).toBe(404);
      expect(await res.text()).not.toContain("ReceiptOCR");
    },
  );

  it("the full file adds plans and FAQ without inventing a price for Custom", () => {
    const full = llmsFullTxt();
    expect(full).toContain("## FAQ");
    expect(full).toContain("There is no public price");
    expect(full).not.toContain("## Optional");
  });
});

describe("home title and description", () => {
  it("fit what Google shows and stay on brand", () => {
    expect(homeTitle).toMatch(/· ReceiptOCR$/);
    expect(homeTitle.length).toBeLessThanOrEqual(60);
    expect(homeDescription.length).toBeGreaterThanOrEqual(120);
    expect(homeDescription.length).toBeLessThanOrEqual(155);
  });

  it("name only outputs the product has (CSV and JSON, never Excel) and the free plan", () => {
    for (const text of [homeTitle, homeDescription]) {
      expect(text).toMatch(/CSV/);
      expect(text).toMatch(/JSON/);
      expect(text).not.toMatch(/excel|xlsx|\bapi\b/i);
    }
    expect(homeDescription).toMatch(/\bfree\b/i);
  });
});

describe("home JSON-LD", () => {
  const data = homeJsonLd();
  const graph = data["@graph"] as Array<Record<string, unknown>>;
  const byType = (type: string) => graph.find((n) => n["@type"] === type)!;

  it("has the expected nodes with absolute prod URLs and linked ids", () => {
    expect(data["@context"]).toBe("https://schema.org");
    expect(graph.map((n) => n["@type"])).toEqual([
      "Person",
      "Organization",
      "WebSite",
      "WebApplication",
    ]);
    const orgId = byType("Organization")["@id"];
    expect(byType("Organization").logo).toBe(`${PRODUCTION_ORIGIN}/icons/icon-512.png`);
    expect(byType("Organization").founder).toEqual({ "@id": byType("Person")["@id"] });
    expect(byType("Person").name).toBe("Bhimraj Yadav");
    expect(byType("WebSite").publisher).toEqual({ "@id": orgId });
    expect(byType("WebApplication").publisher).toEqual({ "@id": orgId });
    for (const node of graph) {
      expect(String(node["@id"]), String(node["@type"])).toMatch(/^https:\/\//);
      expect(String(node.url)).toMatch(/^https:\/\//);
    }
    expect(byType("WebSite").url).toBe(`${PRODUCTION_ORIGIN}/`);
  });

  it("describes the app honestly: web business app, free offer, real features, no ratings", () => {
    const app = byType("WebApplication");
    expect(app).toMatchObject({
      name: "ReceiptOCR",
      description: homeDescription,
      applicationCategory: "BusinessApplication",
      operatingSystem: "Web",
      isAccessibleForFree: true,
    });
    const features = app.featureList as string[];
    expect(features.length).toBeGreaterThan(0);
    expect(features.every((f) => typeof f === "string" && f.length > 0)).toBe(true);
    expect(features).toEqual(
      expect.arrayContaining([expect.stringMatching(/CSV/), expect.stringMatching(/JSON/)]),
    );
    expect(app.offers).toEqual({
      "@type": "Offer",
      name: "Free plan",
      price: "0",
      priceCurrency: "USD",
      availability: "https://schema.org/InStock",
      url: `${PRODUCTION_ORIGIN}/sign-up`,
    });
    const text = JSON.stringify(graph);
    expect(text).not.toMatch(/aggregateRating|"review"|ratingValue/i);
    expect(text).not.toMatch(/excel|xlsx/i);
    // Every node's text is a string, number, boolean or nested object; no empty values.
    const walk = (value: unknown, path: string) => {
      if (value === "" || value === null || value === undefined) throw new Error(`empty ${path}`);
      if (Array.isArray(value)) value.forEach((v, i) => walk(v, `${path}[${i}]`));
      else if (typeof value === "object")
        for (const [k, v] of Object.entries(value as object)) walk(v, `${path}.${k}`);
    };
    walk(data, "$");
  });

  it("escapes < so text cannot close the script tag", () => {
    expect(jsonLdScript({ a: "</script>" })).not.toContain("</script>");
  });
});

describe("next.config headers and redirects", () => {
  it("adds noindex off production and scopes the path noindex rules to production", async () => {
    const rules = await nextConfig.headers!();
    const catchAll = rules.find((r) => r.source === "/:path*" && "missing" in r);
    expect(catchAll?.headers).toEqual([{ key: "X-Robots-Tag", value: "noindex, nofollow" }]);
    const app = rules.find((r) => r.source === "/app/:path*");
    expect(app && "has" in app && app.has).toBeTruthy();
  });

  it("redirects www to the production host permanently", async () => {
    const [www] = await nextConfig.redirects!();
    expect(www).toMatchObject({
      destination: `https://${PRODUCTION_HOST}/:path*`,
      permanent: true,
    });
  });
});
