import { describe, expect, it } from "vitest";
import nextConfig from "../next.config";
import { robotsFor } from "@/app/robots";
import sitemap from "@/app/sitemap";
import { llmsFullTxt, llmsResponse, llmsTxt } from "@/lib/llms";
import { homeJsonLd, jsonLdScript } from "@/lib/seo";
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
      ["/", "/pricing", "/privacy", "/terms", "/cookies", "/refunds"].map((p) =>
        new URL(p, PRODUCTION_ORIGIN).toString(),
      ),
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

describe("home JSON-LD", () => {
  const graph = homeJsonLd()["@graph"] as Array<Record<string, unknown>>;
  const byType = (type: string) => graph.find((n) => n["@type"] === type)!;

  it("has the expected nodes with absolute prod URLs", () => {
    expect(graph.map((n) => n["@type"])).toEqual([
      "Person",
      "Organization",
      "WebSite",
      "SoftwareApplication",
    ]);
    expect(byType("Organization").logo).toBe(`${PRODUCTION_ORIGIN}/icons/icon-512.png`);
    expect(byType("Organization").founder).toEqual({ "@id": byType("Person")["@id"] });
    expect(byType("Person").name).toBe("Bhimraj Yadav");
  });

  it("describes the app honestly", () => {
    const app = byType("SoftwareApplication");
    expect(app.applicationCategory).toBe("FinanceApplication");
    expect(app.offers).toMatchObject({ "@type": "Offer", price: "0", priceCurrency: "USD" });
    expect(JSON.stringify(graph)).not.toMatch(/aggregateRating|review/i);
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
