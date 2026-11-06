import { expect, test } from "@playwright/test";
import { seedReceipts, signUp, uniqueEmail } from "./helpers";

// Sign-up is limited per client IP; give every test (and retry) its own address.
test.beforeEach(async ({ context }) => {
  const octet = () => Math.floor(Math.random() * 255);
  await context.setExtraHTTPHeaders({ "x-forwarded-for": `10.${octet()}.${octet()}.${octet()}` });
});

test("create a group from a selection, filter History by it, export it, then manage it", async ({
  page,
}) => {
  const email = uniqueEmail("groups");
  await signUp(page, email);
  await seedReceipts(email, ["Café Berlin", "Hotel Berlin", "Office Depot"]);

  // Select two receipts and add them to a new group from the picker.
  await page.goto("/app/history");
  await page.getByRole("link", { name: "Select" }).click();
  const list = page.getByRole("list", { name: "Receipts to select" });
  await list.getByText("Café Berlin").click();
  await list.getByText("Hotel Berlin").click();
  await expect(page.getByText("2 receipts selected")).toBeVisible();
  await page.getByRole("button", { name: "Add to group" }).click();
  await page.getByLabel("Search or create a group").fill("Berlin trip");
  await page.getByRole("button", { name: "Create “Berlin trip”" }).click();
  await expect(page.getByText("Added 2 receipts to Berlin trip")).toBeVisible();
  await page.getByRole("link", { name: "Done selecting" }).click();

  // Filter by the group.
  const filter = page.getByRole("group", { name: "Filter by group" });
  await filter.getByRole("button", { name: /Berlin trip/ }).click();
  await expect(page).toHaveURL(/group=[0-9a-f-]{36}/);
  const table = page.getByRole("table");
  await expect(table.getByRole("link", { name: "Café Berlin" })).toBeVisible();
  await expect(table.getByRole("link", { name: "Hotel Berlin" })).toBeVisible();
  await expect(table.getByRole("link", { name: "Office Depot" })).toHaveCount(0);

  // The filtered export carries the group filter and a groups column.
  const exportLink = page.getByRole("link", { name: "Export filtered CSV" });
  const href = await exportLink.getAttribute("href");
  expect(href).toMatch(/group=/);
  const csv = await (await page.request.get(href!)).text();
  const [header, ...rows] = csv.trimEnd().split("\n");
  expect(header).toContain(",groups,");
  expect(rows).toHaveLength(2);
  for (const row of rows) expect(row).toContain("Berlin trip");
  expect(csv).not.toContain("Office Depot");

  // Add the third receipt from its detail page.
  await page.goto("/app/history");
  await page.getByRole("table").getByRole("link", { name: "Office Depot" }).click();
  await page.getByRole("button", { name: "Add to group" }).click();
  await page.getByRole("checkbox", { name: "Berlin trip" }).check();
  const chips = page.getByRole("group", { name: "Groups" });
  await expect(chips.getByRole("link", { name: "Berlin trip" })).toBeVisible();
  await page.keyboard.press("Escape");
  await chips.getByRole("button", { name: "Remove from Berlin trip" }).click();
  await expect(chips.getByRole("link", { name: "Berlin trip" })).toHaveCount(0);

  // Rename, then delete: the receipts stay.
  await page.goto("/app/groups");
  await page.getByRole("button", { name: "Edit Berlin trip" }).click();
  const edit = page.getByRole("dialog", { name: "Edit group" });
  await edit.getByLabel("Name").fill("Berlin 2026");
  // The radio is visually hidden; people click its swatch (the label).
  await edit.locator("label").filter({ hasText: "Blue" }).click();
  await expect(edit.getByRole("radio", { name: "Blue" })).toBeChecked();
  await edit.getByRole("button", { name: "Save" }).click();
  const groups = page.getByRole("list", { name: "Groups" });
  await expect(groups.getByText("Berlin 2026", { exact: true })).toBeVisible();
  await expect(groups.getByRole("link", { name: "2 receipts in Berlin 2026" })).toBeVisible();

  await page.getByRole("button", { name: "Delete Berlin 2026" }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toContainText("2 receipts stay in History");
  await dialog.getByRole("button", { name: "Delete group" }).click();
  await expect(page.getByText("No groups yet")).toBeVisible();
  await page.goto("/app/history");
  await expect(page.getByText("3 receipts in this workspace")).toBeVisible();
});

test("group names are unique per workspace ignoring case", async ({ page }) => {
  await signUp(page, uniqueEmail("groups-dup"));
  await page.goto("/app/groups");
  await page.getByLabel("Name").fill("Taxes 2026");
  await page.getByRole("button", { name: "Create group" }).click();
  await expect(
    page.getByRole("list", { name: "Groups" }).getByText("Taxes 2026", { exact: true }),
  ).toBeVisible();
  await page.getByLabel("Name").fill("taxes 2026");
  await page.getByRole("button", { name: "Create group" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "already exists" })).toBeVisible();
});

test("on a phone the picker opens as a sheet and works by keyboard", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const email = uniqueEmail("groups-phone");
  await signUp(page, email);
  const [id] = await seedReceipts(email, ["Client lunch"]);
  await page.goto(`/app/receipts/${id}`);
  await page.getByRole("button", { name: "Add to group" }).click();
  const sheet = page.getByRole("dialog", { name: "Add to group" });
  await expect(sheet).toBeVisible();
  await sheet.getByLabel("Search or create a group").fill("Client A");
  await page.keyboard.press("Enter");
  await expect(sheet.getByRole("checkbox", { name: "Client A" })).toBeChecked();
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
  await expect(
    page.getByRole("group", { name: "Groups" }).getByRole("link", { name: "Client A" }),
  ).toBeVisible();
  // No sideways scroll at 390.
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});
