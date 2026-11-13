import { expect, test } from "@playwright/test";
import { seedReceipts, signUp, uniqueEmail } from "./helpers";

test("Report a problem opens the support form about that receipt, from the menu and the phone sheet", async ({
  page,
}) => {
  const email = uniqueEmail("report");
  await signUp(page, email);
  const [id] = await seedReceipts(email, ["Report Test Shop"]);

  await page.goto(`/app/receipts/${id}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Report Test Shop");
  // No floating bubble inside the app.
  await expect(page.getByRole("button", { name: "Contact support" })).toHaveCount(0);

  await page.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: "Report a problem" }).click();
  const dialog = page.getByRole("dialog", { name: "How can we help?" });
  await expect(dialog.getByRole("button", { name: "Problem" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(dialog.getByText("We'll see which receipt this is about.")).toBeVisible();
  await expect(dialog.getByLabel("Email", { exact: true })).toHaveValue(email);

  await dialog.getByLabel("Message").fill("The total on this receipt is wrong.");
  const sent = page.waitForRequest(
    (request) => request.url().endsWith("/api/contact") && request.method() === "POST",
  );
  await dialog.getByRole("button", { name: /Send message/ }).click();
  expect((await sent).postDataJSON()).toMatchObject({ topic: "problem", receiptId: id });
  await expect(dialog.getByText("Your message is on its way.")).toBeVisible();
  await dialog.getByRole("button", { name: "Close" }).click();
  await expect(page.getByRole("button", { name: "More actions" })).toBeFocused();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await page.getByRole("button", { name: "Receipt actions" }).click();
  await page.getByRole("button", { name: "Report a problem" }).click();
  await expect(
    page
      .getByRole("dialog", { name: "How can we help?" })
      .getByText("We'll see which receipt this is about."),
  ).toBeVisible();
});
