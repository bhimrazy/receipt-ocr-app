import { expect, test, type Page } from "@playwright/test";
import { signUp, uniqueEmail } from "./helpers";

// Needs a build with NEXT_PUBLIC_GA_MEASUREMENT_ID=G-E2ETEST01: `scripts/test.sh --analytics`.
// Google is never contacted: gtag.js is answered with a stub and collection hits are aborted.
test.skip(!process.env.E2E_GA, "E2E_GA=1 with a GA build only");

const GTAG = /^https:\/\/www\.googletagmanager\.com\/gtag\/js/;

async function stubGoogle(page: Page) {
  const gtagLoads: string[] = [];
  await page.route(GTAG, (route) => {
    gtagLoads.push(page.url());
    return route.fulfill({ contentType: "text/javascript", body: "window.__gtagStub = true;" });
  });
  await page.route(/google-analytics\.com|analytics\.google\.com/, (route) => route.abort());
  return gtagLoads;
}

/** dataLayer entries as plain arrays (gtag pushes Arguments objects). */
const dataLayer = (page: Page) =>
  page.evaluate(() =>
    ((window as unknown as { dataLayer?: ArrayLike<unknown>[] }).dataLayer ?? []).map((a) =>
      Array.from(a),
    ),
  );

const banner = (page: Page) => page.getByRole("region", { name: "Cookies on ReceiptOCR" });

test("Reject all loads no GA, and the choice persists", async ({ page, context }) => {
  const gtagLoads = await stubGoogle(page);
  await page.goto("/");
  await expect(banner(page)).toBeVisible();
  // Equal weight: the three choices are the same size.
  const boxes = await Promise.all(
    ["Accept all", "Reject all", "Customise"].map((name) =>
      banner(page).getByRole("button", { name }).boundingBox(),
    ),
  );
  expect(new Set(boxes.map((b) => `${Math.round(b!.width)}x${Math.round(b!.height)}`)).size).toBe(
    1,
  );

  await banner(page).getByRole("button", { name: "Reject all" }).click();
  await expect(page.getByRole("status")).toContainText("You rejected analytics cookies");
  await expect(page.getByRole("status")).toBeFocused();

  const consent = (await context.cookies()).find((c) => c.name === "consent");
  expect(decodeURIComponent(consent!.value)).toContain("analytics=0");
  expect(consent!.sameSite).toBe("Lax");
  expect(consent!.expires * 1000 - Date.now()).toBeGreaterThan(180 * 86_400_000);

  await page.goto("/sign-in");
  await expect(banner(page)).toHaveCount(0);
  expect(gtagLoads).toEqual([]);
});

test("Accept all loads GA with only analytics consent granted", async ({ page }) => {
  const gtagLoads = await stubGoogle(page);
  await page.goto("/sign-in?redirect=/app/receipts/secret-id");
  await banner(page).getByRole("button", { name: "Accept all" }).click();
  await expect.poll(() => gtagLoads.length).toBe(1);

  const layer = await dataLayer(page);
  expect(layer[0]).toEqual([
    "consent",
    "default",
    {
      analytics_storage: "denied",
      ad_storage: "denied",
      ad_user_data: "denied",
      ad_personalization: "denied",
    },
  ]);
  expect(layer).toContainEqual(["consent", "update", { analytics_storage: "granted" }]);
  const pageView = layer.find((e) => e[0] === "event" && e[1] === "page_view");
  expect((pageView![2] as { page_location: string }).page_location).toMatch(/\/sign-in$/);

  // gtag's automatic hits default page_location to location.href, so config and set carry a
  // stripped one (no ?redirect=).
  const carriers = layer.filter((e) => e[0] === "config" || e[0] === "set");
  expect(carriers.length).toBeGreaterThanOrEqual(2);
  for (const entry of carriers) {
    const args = (entry[0] === "config" ? entry[2] : entry[1]) as { page_location: string };
    expect(args.page_location).not.toContain("?");
  }
  expect(JSON.stringify(layer)).not.toContain("secret-id");

  // Persists: the next page loads GA without asking.
  await page.goto("/");
  await expect(banner(page)).toHaveCount(0);
  await expect.poll(() => gtagLoads.length).toBe(2);
});

test("Cookie settings in the footer reopens the choice and withdrawing deletes GA cookies", async ({
  page,
  context,
  baseURL,
}) => {
  await stubGoogle(page);
  await page.goto("/");
  await banner(page).getByRole("button", { name: "Accept all" }).click();
  await context.addCookies([{ name: "_ga", value: "GA1.1.123.456", url: baseURL! }]);

  await page.getByRole("contentinfo").getByRole("button", { name: "Cookie settings" }).click();
  const dialog = page.getByRole("dialog", { name: "Cookie settings" });
  const toggle = dialog.getByRole("switch", { name: "Analytics cookies (Google Analytics)" });
  await expect(toggle).toBeChecked();
  await toggle.click();
  await dialog.getByRole("button", { name: "Save choices" }).click();
  await expect(dialog).toBeHidden();

  await expect
    .poll(async () => (await context.cookies()).some((c) => c.name === "_ga"))
    .toBe(false);
  expect(await dataLayer(page)).toContainEqual([
    "consent",
    "update",
    { analytics_storage: "denied" },
  ]);
});

test("Customise starts with analytics off and Escape closes it", async ({ page }) => {
  await stubGoogle(page);
  await page.goto("/");
  await banner(page).getByRole("button", { name: "Customise" }).click();
  const dialog = page.getByRole("dialog", { name: "Cookie settings" });
  await expect(dialog.getByRole("switch", { name: /Google Analytics/ })).not.toBeChecked();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(banner(page)).toBeVisible();
});

test("Global Privacy Control answers for the visitor: no banner, GA stays off", async ({
  page,
}) => {
  const gtagLoads = await stubGoogle(page);
  await page.addInitScript(() =>
    Object.defineProperty(Navigator.prototype, "globalPrivacyControl", { get: () => true }),
  );
  await page.goto("/");
  await page.getByRole("contentinfo").getByRole("button", { name: "Cookie settings" }).click();
  const dialog = page.getByRole("dialog", { name: "Cookie settings" });
  await expect(dialog).toContainText("Your browser sends Global Privacy Control");
  await expect(dialog.getByRole("switch", { name: /Google Analytics/ })).toBeDisabled();
  await expect(banner(page)).toHaveCount(0);
  expect(gtagLoads).toEqual([]);
});

test("nothing loads in the app, even after an accept", async ({ page }) => {
  const gtagLoads = await stubGoogle(page);
  await page.goto("/sign-up");
  await banner(page).getByRole("button", { name: "Accept all" }).click();
  await expect.poll(() => gtagLoads.length).toBe(1);

  // Client-side navigation into /app: gtag.js is on the page but switched off.
  await signUp(page, uniqueEmail("consent"));
  expect(
    await page.evaluate(
      () => (window as unknown as Record<string, unknown>)["ga-disable-G-E2ETEST01"],
    ),
  ).toBe(true);

  // A full load of /app never requests gtag.js and shows no banner.
  const before = gtagLoads.length;
  await page.goto("/app");
  await expect(banner(page)).toHaveCount(0);
  expect(gtagLoads.length).toBe(before);
});
