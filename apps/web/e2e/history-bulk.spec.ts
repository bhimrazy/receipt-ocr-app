import { expect, test } from "@playwright/test";
import { seedReceipts, signUp, uniqueEmail } from "./helpers";

// Sign-up is limited per client IP; give every test (and retry) its own address.
test.beforeEach(async ({ context }) => {
  const octet = () => Math.floor(Math.random() * 255);
  await context.setExtraHTTPHeaders({ "x-forwarded-for": `10.${octet()}.${octet()}.${octet()}` });
});

test("sort, page size, select across pages and delete in bulk on desktop", async ({ page }) => {
  const email = uniqueEmail("bulk");
  await signUp(page, email);
  const merchants = Array.from({ length: 27 }, (_, i) => `Shop ${String(i + 1).padStart(2, "0")}`);
  await seedReceipts(email, merchants);

  await page.goto("/app/history");
  const pagination = page.getByRole("navigation", { name: "Pagination" });
  await expect(pagination).toContainText("1–25 of 27");

  // Sort by merchant, A to Z, kept in the URL.
  await page.getByRole("link", { name: /^Merchant/ }).click();
  await expect(page).toHaveURL(/sort=merchant&dir=asc/);
  const table = page.getByRole("table");
  await expect(table.locator("tbody").getByRole("link").first()).toHaveText("Shop 01");

  // Tick a row, go to page 2, tick another: both stay selected.
  await page.getByRole("checkbox", { name: "Select Shop 01" }).check();
  await pagination.getByRole("link", { name: "Next" }).click();
  await expect(pagination).toContainText("26–27 of 27");
  await page.getByRole("checkbox", { name: "Select Shop 27" }).check();
  const bar = page.getByRole("toolbar", { name: "Selected receipts" });
  await expect(bar).toContainText("2 receipts selected");

  await bar.getByRole("button", { name: "Delete" }).click();
  const confirm = page.getByRole("alertdialog", { name: "Delete 2 receipts?" });
  await expect(confirm).toContainText("Their photos are deleted too. This can't be undone.");
  await confirm.getByRole("button", { name: "Delete 2 receipts" }).click();
  await expect(page.getByText("Deleted 2 receipts")).toBeVisible();
  await expect(page.getByText("25 receipts in this workspace")).toBeVisible();

  // A search, then the whole page: Shop 10 to Shop 19.
  await page.getByLabel("Search receipts").fill("Shop 1");
  await expect(page).toHaveURL(/q=Shop/);
  await expect(pagination).toContainText("1–10 of 10");
  await page.getByRole("checkbox", { name: "Select all on this page" }).check();
  await expect(bar).toContainText("10 receipts selected");
  await bar.getByRole("button", { name: "Delete" }).click();
  await page
    .getByRole("alertdialog", { name: "Delete 10 receipts?" })
    .getByRole("button", { name: "Delete 10 receipts" })
    .click();
  await expect(page.getByText("Deleted 10 receipts")).toBeVisible();
  await expect(page.getByText("No receipts match")).toBeVisible();
});

test("the row menu, then delete all that match a filter across pages", async ({ page }) => {
  const email = uniqueEmail("bulk-all");
  await signUp(page, email);
  await seedReceipts(email, [...Array.from({ length: 30 }, (_, i) => `Cafe ${i + 1}`), "Hardware"]);
  await page.goto("/app/history");

  // One row's menu deletes just that receipt.
  await page.getByRole("button", { name: "Actions for Cafe 30" }).click();
  await page.getByRole("menuitem", { name: "Delete" }).click();
  await page
    .getByRole("alertdialog", { name: "Delete this receipt?" })
    .getByRole("button", { name: "Delete receipt" })
    .click();
  await expect(page.getByText("Deleted 1 receipt")).toBeVisible();
  await expect(page.getByText("30 receipts in this workspace")).toBeVisible();

  // 29 cafes match the search, over two pages: select them all and delete them.
  await page.goto("/app/history?q=Cafe");
  await expect(page.getByRole("navigation", { name: "Pagination" })).toContainText("1–25 of 29");
  await page.getByRole("checkbox", { name: "Select all on this page" }).check();
  await page.getByRole("button", { name: "Select all 29 receipts that match" }).click();
  await expect(page.getByRole("button", { name: "Clear selection" })).toBeVisible();
  const bar = page.getByRole("toolbar", { name: "Selected receipts" });
  await expect(bar).toContainText("29 receipts selected");
  await bar.getByRole("button", { name: "Delete" }).click();
  await page
    .getByRole("alertdialog", { name: "Delete 29 receipts?" })
    .getByRole("button", { name: "Delete 29 receipts" })
    .click();
  await expect(page.getByText("Deleted 29 receipts")).toBeVisible();
  await expect(page.getByText("No receipts match")).toBeVisible();

  // Only what matched went.
  await page.goto("/app/history");
  await expect(page.getByText("1 receipt in this workspace")).toBeVisible();
  await expect(page.getByRole("table").getByRole("link", { name: "Hardware" })).toBeVisible();
});

test("on a phone, Select turns rows into checkboxes with actions over the tab bar", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const email = uniqueEmail("bulk-phone");
  await signUp(page, email);
  await seedReceipts(email, ["Bakery", "Bookshop", "Bike repair"]);
  await page.goto("/app/history");
  await page.getByRole("button", { name: "Select", exact: true }).click();
  await page.getByRole("checkbox", { name: "Select Bakery" }).check();
  await page.getByRole("checkbox", { name: "Select Bookshop" }).check();
  const bar = page.getByRole("toolbar", { name: "Selected receipts" });
  await expect(bar).toBeInViewport();
  await bar.getByRole("button", { name: "Delete" }).click();
  await page
    .getByRole("alertdialog", { name: "Delete 2 receipts?" })
    .getByRole("button", { name: "Delete 2 receipts" })
    .click();
  await expect(page.getByText("Deleted 2 receipts")).toBeVisible();
  await page.getByRole("button", { name: "Done" }).click();
  await expect(bar).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});
