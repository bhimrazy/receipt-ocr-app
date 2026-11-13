import { expect, test, type Page } from "@playwright/test";
import { signUp, uniqueEmail } from "./helpers";

// next.config.ts and app/robots.ts key on the request host; the test server is localhost.
const PROD_HOST = "receipt-ocr.bhimraj.com.np";

const CONTENT = [
  "/use-cases",
  "/use-cases/expense-reports",
  "/use-cases/bookkeeping",
  "/use-cases/freelancers-taxes",
  "/use-cases/small-businesses",
];
const INDEXABLE = ["/", "/pricing", "/privacy", "/terms", "/cookies", "/refunds", ...CONTENT];
const NOINDEX_PUBLIC = ["/sign-in", "/sign-up", "/forgot-password", "/reset-password"];

const meta = (page: Page, selector: string) =>
  page.locator(selector).first().getAttribute("content");

async function headTags(page: Page) {
  return {
    title: await page.title(),
    description: await meta(page, 'meta[name="description"]'),
    robots: (await meta(page, 'meta[name="robots"]')) ?? "",
    canonical: await page
      .locator('link[rel="canonical"]')
      .first()
      .getAttribute("href", {
        timeout: 1_000,
      })
      .catch(() => null),
    ogTitle: await meta(page, 'meta[property="og:title"]'),
    ogUrl: await meta(page, 'meta[property="og:url"]'),
    ogImage: await meta(page, 'meta[property="og:image"]'),
    twitterImage: await meta(page, 'meta[name="twitter:image"]'),
  };
}

test("indexable pages have unique titles and descriptions, a canonical and a working OG image", async ({
  page,
  request,
}) => {
  const titles = new Set<string>();
  const descriptions = new Set<string>();
  for (const path of INDEXABLE) {
    const res = await page.goto(path);
    expect(res?.status(), path).toBe(200);
    const tags = await headTags(page);

    expect(tags.title.length, `${path} title`).toBeGreaterThan(10);
    expect(tags.title.length, `${path} title`).toBeLessThanOrEqual(65);
    expect(tags.description?.length ?? 0, `${path} description`).toBeGreaterThanOrEqual(50);
    expect(tags.description?.length ?? 0, `${path} description`).toBeLessThanOrEqual(160);
    expect(tags.robots, path).not.toContain("noindex");
    titles.add(tags.title);
    descriptions.add(tags.description!);

    // Hosts differ between the build's NEXT_PUBLIC_SITE_URL and the test server; paths must match.
    expect(tags.canonical, `${path} canonical`).toBeTruthy();
    expect(new URL(tags.canonical!).pathname).toBe(path);
    expect(new URL(tags.ogUrl!).pathname).toBe(path);
    expect(tags.ogTitle, path).toBe(tags.title);
    expect(tags.twitterImage, path).toBeTruthy();

    const image = await request.get(new URL(tags.ogImage!).pathname);
    expect(image.status(), `${path} og:image`).toBe(200);
    expect(image.headers()["content-type"]).toBe("image/png");

    await expect(page.locator("h1"), `${path} has one h1`).toHaveCount(1);
  }
  expect(titles.size).toBe(INDEXABLE.length);
  expect(descriptions.size).toBe(INDEXABLE.length);
});

test("the home page's structured data is valid and makes no rating or review claims", async ({
  page,
}) => {
  await page.goto("/");
  const blocks = await page.locator('script[type="application/ld+json"]').allTextContents();
  const types = blocks.flatMap((text) => {
    const data = JSON.parse(text) as { "@type"?: string; "@graph"?: Array<{ "@type": string }> };
    return data["@graph"]?.map((node) => node["@type"]) ?? [data["@type"]];
  });
  expect(types).toEqual(
    expect.arrayContaining(["Organization", "WebSite", "WebApplication", "FAQPage"]),
  );
  expect(blocks.join("")).not.toMatch(/aggregateRating|"review"/i);
  // FAQPage is only honest while the FAQ is on the page.
  await expect(page.locator("#faq details")).not.toHaveCount(0);
});

test("content pages carry breadcrumbs and FAQ structured data that match what is on the page", async ({
  page,
}) => {
  for (const path of CONTENT) {
    await page.goto(path);
    const graph = (await page.locator('script[type="application/ld+json"]').allTextContents())
      .map((text) => JSON.parse(text) as { "@graph"?: Array<Record<string, unknown>> })
      .flatMap((data) => data["@graph"] ?? []);
    const crumbs = graph.find((n) => n["@type"] === "BreadcrumbList") as
      { itemListElement: Array<{ item: string }> } | undefined;
    expect(crumbs, path).toBeTruthy();
    expect(new URL(crumbs!.itemListElement.at(-1)!.item).pathname, path).toBe(path);
    await expect(page.getByRole("navigation", { name: "Breadcrumb" }), path).toBeVisible();
    await expect(page.getByRole("link", { name: /get started free/i }).first(), path).toBeVisible();

    const faq = graph.find((n) => n["@type"] === "FAQPage") as
      { mainEntity: Array<{ name: string }> } | undefined;
    if (path === "/use-cases") {
      // The hub links every use case.
      for (const other of CONTENT.slice(1)) {
        await expect(page.locator(`main a[href="${other}"]`), other).not.toHaveCount(0);
      }
      continue;
    }
    expect(faq, path).toBeTruthy();
    const questions = await page.locator("details summary").allTextContents();
    expect(
      questions.map((q) => q.trim()),
      path,
    ).toEqual(faq!.mainEntity.map((q) => q.name));
    await expect(page.locator(`footer a[href="${path}"]`), path).toHaveCount(1);
  }
  expect(await page.request.get("/use-cases/no-such-page").then((r) => r.status())).toBe(404);
});

test("auth pages are noindex but still describe themselves", async ({ page }) => {
  for (const path of NOINDEX_PUBLIC) {
    const res = await page.goto(path);
    expect(res?.status(), path).toBe(200);
    expect(res?.headers()["x-robots-tag"], path).toContain("noindex");
    const tags = await headTags(page);
    expect(tags.robots, path).toContain("noindex");
    expect(tags.description, path).toBeTruthy();
    expect(tags.ogImage, path).toBeTruthy();
  }
});

test("signed-in pages send noindex, and signed-out visits redirect with it too", async ({
  page,
  request,
}) => {
  const redirect = await request.get("/app/receipts", { maxRedirects: 0 });
  expect(redirect.status()).toBe(307);
  expect(redirect.headers()["x-robots-tag"]).toContain("noindex");

  await signUp(page, uniqueEmail("seo"));
  for (const path of ["/app", "/app/receipts", "/app/settings"]) {
    const res = await page.goto(path);
    expect(res?.status(), path).toBe(200);
    expect(res?.headers()["x-robots-tag"], path).toContain("noindex");
    expect(await meta(page, 'meta[name="robots"]'), path).toContain("noindex");
  }
});

test("every crawlable noindex path also sends the header, and the invitation page has the meta tag", async ({
  page,
  request,
}) => {
  for (const path of ["/admin", "/admin/users", "/api/health", "/accept-invitation/none"]) {
    const res = await request.get(path, { maxRedirects: 0 });
    expect(res.headers()["x-robots-tag"], path).toContain("noindex");
  }
  await page.goto("/accept-invitation/none");
  expect(await meta(page, 'meta[name="robots"]')).toContain("noindex");
});

test("only the production host is indexable: robots.txt, X-Robots-Tag and llms.txt follow the host", async ({
  request,
}) => {
  // localhost is not production.
  expect(await (await request.get("/robots.txt")).text()).toMatch(/Disallow: \/\s*$/m);
  const local = await request.get("/privacy");
  expect(local.headers()["x-robots-tag"]).toBe("noindex, nofollow");
  expect((await request.get("/llms.txt")).status()).toBe(404);

  const asProd = { headers: { host: PROD_HOST } };
  const robots = await (await request.get("/robots.txt", asProd)).text();
  expect(robots).toContain("Allow: /");
  expect(robots).toContain("Disallow: /api/");
  expect(robots).toContain(`Sitemap: https://${PROD_HOST}/sitemap.xml`);
  const privacy = await request.get("/privacy", asProd);
  expect(privacy.headers()["x-robots-tag"] ?? "").not.toContain("noindex");
  const llms = await request.get("/llms.txt", asProd);
  expect(llms.status()).toBe(200);
  expect(await llms.text()).toContain("https://github.com/bhimrazy/receipt-ocr");
});

test("robots.txt and the sitemap agree with what is indexable", async ({ request }) => {
  const sitemap = await (await request.get("/sitemap.xml")).text();
  const paths = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => new URL(m[1]!).pathname);
  expect(paths.sort()).toEqual([...INDEXABLE].sort());

  expect((await request.get("/no-such-page")).status()).toBe(404);
  const slash = await request.get("/privacy/", { maxRedirects: 0 });
  expect(slash.status()).toBe(308);
  expect(slash.headers().location).toBe("/privacy");
});
