import { expect, test } from "@playwright/test";
import { seedReceipts, signUp, uniqueEmail } from "./helpers";

test("Help and feedback opens the support form from Settings and the account menu, with no bubble", async ({
  page,
}) => {
  await signUp(page, uniqueEmail("help"));
  const dialog = page.getByRole("dialog", { name: "How can we help?" });

  await page.goto("/app/settings");
  await expect(page.getByRole("button", { name: "Contact support" })).toHaveCount(0);
  await page.getByRole("button", { name: "Help and feedback" }).click();
  await expect(dialog.getByRole("button", { name: "Question" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(dialog.getByText("We'll see which receipt this is about.")).toHaveCount(0);
  await dialog.getByRole("button", { name: "Close" }).click();

  await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("menuitem", { name: "Help and feedback" }).click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Close" }).click();
  await expect(page.getByRole("button", { name: "Account menu" })).toBeFocused();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await page
    .getByRole("navigation", { name: "Settings" })
    .getByRole("button", { name: "Help and feedback" })
    .click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Close" }).click();
  await page.getByRole("button", { name: "Account and workspace" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Help and feedback" }).click();
  await expect(dialog).toBeVisible();
});

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
  // The e2e server has no support inbox, so the route would answer 503; only the request is under test here.
  let sent: unknown;
  await page.route("**/api/contact", (route) => {
    sent = route.request().postDataJSON();
    return route.fulfill({ json: { ok: true } });
  });
  await dialog.getByRole("button", { name: /Send message/ }).click();
  await expect(dialog.getByText("Your message is on its way.")).toBeVisible();
  expect(sent).toMatchObject({ topic: "problem", receiptId: id });
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
