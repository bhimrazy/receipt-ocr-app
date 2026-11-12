import { expect, test } from "@playwright/test";
import postgres from "postgres";
import { seedReceipts, signUp, uniqueEmail } from "./helpers";

test("a receipt that printed Bikram Sambat shows BS first, and its date can be corrected in either calendar", async ({
  page,
}) => {
  const email = uniqueEmail("bs-date");
  await signUp(page, email);
  const [id] = await seedReceipts(email, ["Miti Test Shop"]);
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
  try {
    await sql`update receipts set receipt_date = '2023-07-25', receipt_date_calendar = 'bikram-sambat',
      currency = 'NPR', review_reasons = '{date_conflict}' where id = ${id!}`;
  } finally {
    await sql.end();
  }

  await page.goto(`/app/receipts/${id}`);
  const card = page.getByRole("region", { name: "Check before you use this" });
  await expect(card).toContainText("The dates printed on the receipt don't agree.");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Miti Test Shop");
  await expect(page.getByText("9 Shrawan 2080").first()).toBeVisible();
  await expect(page.getByText("25 Jul 2023").first()).toBeVisible();

  // The editor opens in the receipt's calendar, with the AD day it stands for.
  await page.getByRole("button", { name: "Edit details" }).click();
  await expect(page.getByRole("radio", { name: "Bikram Sambat (BS)" })).toBeChecked();
  const date = page.getByLabel("Date", { exact: true });
  await expect(date).toHaveValue("2080-04-09");
  await date.fill("2080-05-32"); // Bhadra 2080 has 31 days
  await expect(page.getByText("Enter a BS date as YYYY-MM-DD, like 2080-04-09.")).toBeVisible();
  await date.fill("2080-04-10");
  await expect(page.getByText("26 Jul 2023 in AD")).toBeVisible();
  await page.getByLabel("Bill number").fill("SI-0042-80/81");
  await page.getByRole("button", { name: "Save changes" }).click();

  // Setting the date clears the date check.
  await expect(page.getByText("10 Shrawan 2080").first()).toBeVisible();
  await expect(card).toBeHidden();
  await expect(page.getByText("SI-0042-80/81", { exact: true })).toBeVisible();

  // Switching to AD keeps the day and stops showing BS.
  await page.getByRole("button", { name: "Edit details" }).click();
  await page.getByRole("radio", { name: "Gregorian (AD)" }).click();
  await expect(page.getByLabel("Date", { exact: true })).toHaveValue("2023-07-26");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("26 Jul 2023").first()).toBeVisible();
  await expect(page.getByText(/Shrawan/)).toHaveCount(0);
});

test("an amount typed with a decimal comma saves, and one the server can't read is refused", async ({
  page,
}) => {
  const email = uniqueEmail("amounts");
  await signUp(page, email);
  const [id] = await seedReceipts(email, ["Comma Test Shop"]);

  await page.goto(`/app/receipts/${id}`);
  await page.getByRole("button", { name: "Edit details" }).click();
  await page.getByLabel("Tip", { exact: true }).fill("1,50");
  await page.getByLabel("Total", { exact: true }).fill("12,30");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("$12.30")).toBeVisible();
  await expect(page.getByText("$1.50")).toBeVisible();

  await page.getByRole("button", { name: "Edit details" }).click();
  await page.getByLabel("Tax", { exact: true }).fill("0.8O");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Tax must be an amount, like 12.50.")).toBeVisible();
});
