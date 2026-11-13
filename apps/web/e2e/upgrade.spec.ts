import { expect, test, type Page } from "@playwright/test";
import postgres from "postgres";
import { signUp, uniqueEmail } from "./helpers";

// The e2e stack runs Paddle's sandbox keys under `next start` (NODE_ENV=production), the live
// site's state today: checkout is open to platform admins only, so only they see the upgrade
// surfaces. These tests make their owner an admin. No API key is set, so starting a checkout
// fails on the server; Paddle.js is stubbed and never fetched.

const db = async <T>(fn: (sql: postgres.Sql) => Promise<T>) => {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
  try {
    return await fn(sql);
  } finally {
    await sql.end();
  }
};

const makeAdmin = (email: string) =>
  db((sql) => sql`update "user" set role = 'admin' where email = ${email}`);

/**
 * Free scans used, written to the usage ledger. `month`: at the start of this UTC month, so
 * neither the day limit nor the shared Free pool sees them. `today`: now.
 */
const useScans = (email: string, count: number, when: "month" | "today") =>
  db(async (sql) => {
    const [owner] = await sql<{ user_id: string; organization_id: string }[]>`
      select u.id as user_id, m.organization_id
      from "user" u join member m on m.user_id = u.id
      where u.email = ${email} limit 1`;
    const at =
      when === "month" ? sql`date_trunc('month', now(), 'UTC') + interval '1 minute'` : sql`now()`;
    // Each with a successful model call: an old round without one no longer counts as in flight.
    await sql`
      with rounds as (
        insert into ocr_rounds (receipt_id, organization_id, user_id, round, plan, created_at)
        select gen_random_uuid(), ${owner!.organization_id}, ${owner!.user_id}, 1, 'free', ${at}
        from generate_series(1, ${count})
        returning receipt_id, organization_id, user_id, created_at
      )
      insert into ocr_calls (receipt_id, organization_id, user_id, round, step, model, status, latency_ms, created_at)
      select receipt_id, organization_id, user_id, 1, 1, 'fixture', 'ok', 100, created_at from rounds`;
  });

/** On the 1st (UTC) "earlier this month" is today, where the day limit would block these. */
const firstOfMonth = () => new Date().getUTCDate() === 1;

/** Clicks a dismiss button and waits for its server action, so a reload can't cut it off. */
async function dismissWith(page: Page, button: ReturnType<Page["getByRole"]>) {
  const saved = page.waitForResponse((r) => r.request().method() === "POST" && r.ok());
  await button.click();
  await saved;
}

/** Paddle.js stand-in: records what the page asked of it. */
async function stubPaddle(page: Page) {
  let requested = 0;
  await page.route("https://cdn.paddle.com/**", (route) => {
    requested += 1;
    return route.fulfill({
      contentType: "application/javascript",
      body: `window.Paddle = { Environment: { set() {} }, Initialize(o) { window.__paddleInit = o; },
        Checkout: { open(o) { window.__paddleOpened = o; } } };`,
    });
  });
  return { requested: () => requested };
}

async function adminOwner(page: Page, tag: string) {
  const email = uniqueEmail(tag);
  await signUp(page, email);
  await makeAdmin(email);
  await page.goto("/app");
  return email;
}

const modal = (page: Page) => page.getByRole("dialog", { name: /^Pro for / });
const meterButton = (page: Page) =>
  page.getByRole("complementary").getByRole("link", { name: "Upgrade to Pro" });
const homeCard = (page: Page) => page.getByRole("heading", { name: "Pro for this workspace" });

test("below 20% only the meter offers Pro; from 20% Home shows the card", async ({ page }) => {
  test.skip(firstOfMonth(), "needs earlier days this month");
  const email = await adminOwner(page, "upgrade-warm");
  await useScans(email, 10, "month");
  await page.goto("/app");
  await expect(meterButton(page)).toBeVisible();
  await expect(homeCard(page)).toHaveCount(0);

  await useScans(email, 10, "month");
  await page.reload();
  await expect(homeCard(page)).toBeVisible();
  await expect(page.getByText(/^20 of 100 Free scans used this month\./)).toBeVisible();
  await expect(page.getByRole("link", { name: "See Pro, $9 a month" })).toBeVisible();
});

test("the meter button opens the modal, Escape closes it and focus returns", async ({ page }) => {
  const paddle = await stubPaddle(page);
  await adminOwner(page, "upgrade-meter");
  await page.goto("/app/receipts");
  // Paddle.js loads only once the modal opens.
  expect(paddle.requested()).toBe(0);

  await meterButton(page).click();
  const dialog = modal(page);
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAccessibleName("Pro for E2E User's Workspace");
  await expect(dialog.getByText("Test mode: no real charge")).toBeVisible();
  const table = dialog.getByRole("table");
  await expect(table.getByRole("rowheader", { name: "Scans a month" })).toBeVisible();
  await expect(table.getByRole("cell", { name: /^\d+ per person$/ })).toBeVisible();
  await expect(table.getByRole("cell", { name: /^\d+ shared$/ })).toBeVisible();
  await expect.poll(() => paddle.requested()).toBe(1);

  await dialog.locator("label", { hasText: "Yearly" }).click();
  await expect(
    dialog.getByRole("button", { name: "Continue to checkout, $90 a year" }),
  ).toBeEnabled();

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(meterButton(page)).toBeFocused();
  expect(page.url()).toMatch(/\/app\/receipts$/);
});

test("the primary button asks the server for the checkout and shows its error in place", async ({
  page,
}) => {
  await stubPaddle(page);
  await adminOwner(page, "upgrade-start");
  await page.goto("/app");
  await meterButton(page).click();
  const dialog = modal(page);
  await dialog.getByRole("button", { name: "Continue to checkout, $9 a month" }).click();
  // The stack has no Paddle API key, so the server refuses; the modal stays open and says why.
  await expect(dialog.getByRole("alert")).toHaveText("Paid plans aren't open yet.");
  await expect(dialog).toBeVisible();
  expect(await page.evaluate(() => "__paddleOpened" in window)).toBe(false);
});

test("the account menu offers Pro above Settings and opens the modal", async ({ page }) => {
  await stubPaddle(page);
  await adminOwner(page, "upgrade-menu");
  await page.getByRole("button", { name: "Account menu" }).click();
  const items = page.getByRole("menuitem");
  await expect(items.first()).toHaveText(/^Upgrade to Pro\$9\/mo$/);
  await items.first().click();
  await expect(modal(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Account menu" })).toBeFocused();
});

test("?upgrade=1 opens the modal once and leaves a plain URL", async ({ page }) => {
  await stubPaddle(page);
  await adminOwner(page, "upgrade-link");
  await page.goto("/app/receipts/groups?upgrade=1&via=email");
  await expect(modal(page)).toBeVisible();
  await expect(page).toHaveURL(/\/app\/receipts\/groups$/);
  await page.reload();
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(modal(page)).toHaveCount(0);
});

test("closing the modal keeps the Home card; its Not now survives a reload", async ({ page }) => {
  test.skip(firstOfMonth(), "needs earlier days this month");
  await stubPaddle(page);
  const email = await adminOwner(page, "upgrade-dismiss");
  await useScans(email, 84, "month");
  await page.goto("/app");
  const near = page.getByRole("heading", { name: "You've used 84 of 100 Free scans this month" });
  await expect(near).toBeVisible();

  await page.locator("main").getByRole("link", { name: "Upgrade to Pro" }).click();
  await modal(page).getByRole("button", { name: "Not now" }).click();
  await expect(modal(page)).toBeHidden();
  await expect(near).toBeVisible();

  await dismissWith(page, page.locator("main").getByRole("button", { name: "Not now" }));
  await expect(near).toHaveCount(0);
  await expect(page.locator("#main-content")).toBeFocused();
  // The server leaves it out, so it never renders, not even for a frame.
  const html = await (await page.request.get("/app")).text();
  expect(html).not.toContain("Free scans this month</h2>");
  await page.reload();
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(near).toHaveCount(0);
  // The meter's button is never dismissible.
  await expect(meterButton(page)).toBeVisible();
});

test("at the limit the banner shows on Receipts, not on Home or Upload", async ({ page }) => {
  const email = await adminOwner(page, "upgrade-limit");
  await useScans(email, 20, "today");
  const banner = page.getByRole("complementary", { name: "Plan limit" });

  await page.goto("/app");
  await expect(page.getByRole("heading", { name: "You've reached today's limit" })).toBeVisible();
  await expect(
    page.getByText("Pro allows up to 200 a day in this workspace.").first(),
  ).toBeVisible();
  await expect(page.locator("main").getByRole("link", { name: "Upgrade to Pro" })).toBeVisible();
  await expect(banner).toHaveCount(0);
  await page.goto("/app/upload");
  await expect(page.getByRole("heading", { name: "You've reached today's limit" })).toBeVisible();
  await expect(banner).toHaveCount(0);

  await page.goto("/app/receipts");
  await expect(banner).toBeVisible();
  await expect(banner).toContainText("You've used today's 20 Free scans.");
  await dismissWith(page, banner.getByRole("button", { name: /^Hide until / }));
  await expect(banner).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(banner).toHaveCount(0);
});

test("no offer without checkout for the viewer, or on Pro", async ({ page }) => {
  // A non-admin on sandbox keys under production: Pro isn't open to them.
  await signUp(page, uniqueEmail("upgrade-closed"));
  await expect(page.getByRole("meter", { name: /Scans used/ })).toBeVisible();
  await expect(meterButton(page)).toHaveCount(0);
  await page.getByRole("button", { name: "Account menu" }).click();
  await expect(page.getByRole("menuitem", { name: /Upgrade to Pro/ })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page.goto("/app?upgrade=1");
  await expect(page).toHaveURL(/\/app$/);
  await expect(modal(page)).toHaveCount(0);

  // An admin comp makes every workspace the user owns Pro.
  const email = uniqueEmail("upgrade-pro");
  await page.context().clearCookies();
  await signUp(page, email);
  await makeAdmin(email);
  await db((sql) => sql`update "user" set plan = 'pro' where email = ${email}`);
  await page.goto("/app");
  await expect(page.getByText("Pro plan", { exact: true }).first()).toBeVisible();
  await expect(meterButton(page)).toHaveCount(0);
});

test("Billing's own checkout button runs on the shared checkout", async ({ page }) => {
  const paddle = await stubPaddle(page);
  await adminOwner(page, "upgrade-billing");
  await page.goto("/app/settings/billing");
  await expect(page.getByText("Test mode: no real charge")).toBeVisible();
  await expect.poll(() => paddle.requested()).toBe(1);
  await page.getByRole("button", { name: "Upgrade to Pro, $9 a month" }).click();
  await expect(page.locator("#main-content").getByRole("alert")).toHaveText(
    "Paid plans aren't open yet.",
  );
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test("the account sheet's meter opens the modal as a bottom sheet", async ({ page }) => {
    await stubPaddle(page);
    await adminOwner(page, "upgrade-phone");
    await page.getByRole("button", { name: "Account and workspace" }).click();
    await page.getByRole("dialog").getByRole("link", { name: "Upgrade to Pro" }).click();
    const sheet = modal(page);
    await expect(sheet).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(1);
    const box = (await sheet.boundingBox())!;
    expect(Math.round(box.y + box.height)).toBe(844);
    expect(box.width).toBeLessThanOrEqual(390);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBe(0);
    await expect(
      sheet.getByRole("button", { name: "Continue to checkout, $9 a month" }),
    ).toBeInViewport();
    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();
  });
});
