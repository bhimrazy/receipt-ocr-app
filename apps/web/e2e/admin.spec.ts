import { expect, test, type Browser } from "@playwright/test";
import postgres from "postgres";
import { PASSWORD, signIn, signOut, signUp, uniqueEmail } from "./helpers";

async function sql<T>(run: (db: postgres.Sql) => Promise<T>) {
  const db = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
  try {
    return await run(db);
  } finally {
    await db.end();
  }
}

/** Sign-up is rate-limited per client IP, so each context gets its own address. */
const freshContext = (browser: Browser) =>
  browser.newContext({
    extraHTTPHeaders: {
      "x-forwarded-for": `10.${(Math.random() * 255) | 0}.${(Math.random() * 255) | 0}.${(Math.random() * 255) | 0}`,
    },
  });

/** A signed-up customer in their own browser context, signed out again. */
async function customer(browser: Browser, tag: string) {
  const context = await freshContext(browser);
  const page = await context.newPage();
  const email = uniqueEmail(tag);
  await signUp(page, email);
  await signOut(page);
  return { email, page, context };
}

async function adminPage(browser: Browser) {
  const context = await freshContext(browser);
  const page = await context.newPage();
  const email = uniqueEmail("admin");
  await signUp(page, email);
  await sql((db) => db`update "user" set role = 'admin' where email = ${email}`);
  return { email, page, context };
}

test("admin finds a user, bans them with a reason, and the audit log shows it", async ({
  browser,
}) => {
  const target = await customer(browser, "banned");
  const admin = await adminPage(browser);
  const { page } = admin;

  await page.goto("/admin/users");
  await page.getByRole("searchbox", { name: "Search users by name or email" }).fill(target.email);
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page).toHaveURL(/q=/);
  const row = page.getByRole("link", { name: "E2E User" });
  await expect(row).toHaveCount(1);
  await expect(page.getByRole("table").getByText(target.email)).toBeVisible();
  await row.click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("E2E User");

  const reason = `Spam uploads ${Date.now()}`;
  await page.getByRole("button", { name: "Ban user" }).click();
  const dialog = page.getByRole("dialog", { name: `Ban ${target.email}?` });
  await dialog.getByText("7 days").click();
  await dialog.getByLabel("Reason").fill(reason);
  await dialog.getByRole("button", { name: "Ban user" }).click();
  await expect(dialog).toBeHidden();

  await expect(page.getByRole("status").getByText(/^Banned until/)).toBeVisible();
  await expect(page.getByText(`Reason: ${reason}`).first()).toBeVisible();
  const activity = page.getByRole("region", { name: "Admin activity on this account" });
  await expect(activity.getByText("Banned user")).toBeVisible();
  await expect(activity.getByText(reason)).toBeVisible();
  await expect(activity.getByText(`By ${admin.email}`)).toBeVisible();

  await page.goto(`/admin/audit?q=${encodeURIComponent(reason)}`);
  await expect(page.getByText("Banned user")).toBeVisible();
  await expect(page.getByRole("link", { name: target.email })).toBeVisible();

  // Customer side: the banned user is refused with a plain message.
  await target.page.goto("/sign-in");
  await target.page.getByLabel("Email").fill(target.email);
  await target.page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await target.page.getByRole("button", { name: "Sign in" }).click();
  await expect(target.page.getByText(/This account is suspended/)).toBeVisible();

  await target.context.close();
  await admin.context.close();
});

test("plan limits saved by an admin show on the customer's settings page", async ({ browser }) => {
  const target = await customer(browser, "limits");
  const admin = await adminPage(browser);
  const { page } = admin;
  const before = await sql(
    (db) => db<{ value: unknown }[]>`select value from app_settings where key = 'plans'`,
  );

  try {
    await page.goto("/admin/settings");
    const perDay = page.getByRole("group", { name: "Receipts a day" }).getByLabel("Free plan");
    await perDay.fill("17");
    await page.getByRole("button", { name: "Save limits" }).click();
    await expect(page.getByText("Plan limits saved.")).toBeVisible();

    await page.goto("/admin/audit?type=settings");
    await expect(page.getByText("Changed plan limits").first()).toBeVisible();
    await expect(page.getByText(/Free: \d+ → 17 a day/).first()).toBeVisible();

    await signIn(target.page, target.email);
    await target.page.goto("/app/settings");
    await expect(target.page.getByText("17", { exact: true }).first()).toBeVisible();
  } finally {
    // Other tests expect the defaults: put back whatever was there.
    await sql((db) =>
      before[0]
        ? db`update app_settings set value = ${db.json(before[0].value as never)} where key = 'plans'`
        : db`delete from app_settings where key = 'plans'`,
    );
    await target.context.close();
    await admin.context.close();
  }
});

test("non-admins get a 404 for the admin area", async ({ page }) => {
  await signUp(page, uniqueEmail("not-admin"));
  const response = await page.goto("/admin/users");
  expect(response?.status()).toBe(404);
});
