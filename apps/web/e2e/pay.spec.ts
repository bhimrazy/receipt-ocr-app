import { expect, test, type Page } from "@playwright/test";
import postgres from "postgres";
import { signUp, uniqueEmail } from "./helpers";

// /pay is the Paddle account's default payment link. The e2e stack has Paddle's sandbox public
// settings under `next start`, the live site in test mode: only platform admins may open a
// checkout, as on Billing. Paddle.js is stubbed: the stub records what the page asked of it, and
// a test fires Paddle's events through the callback the page passed to Initialize.

const TXN = "txn_01h2b0qpjc0xt8k5aw6nsdec4p";
const TOKEN = "test_e2e_not_a_real_token";

type PaddleCalls = {
  environment: string[];
  init: { token: string; checkout?: { settings: Record<string, unknown> } } | null;
  opened: { transactionId: string; settings?: Record<string, unknown> }[];
};

async function stubPaddle(page: Page) {
  let requested = 0;
  await page.route("https://cdn.paddle.com/**", (route) => {
    requested += 1;
    return route.fulfill({
      contentType: "application/javascript",
      body: `window.__paddle = { environment: [], init: null, opened: [] };
        window.Paddle = {
          Environment: { set(e) { window.__paddle.environment.push(e); } },
          Initialize(o) {
            if (window.__paddle.init) throw new Error("Initialize called twice");
            window.__paddle.init = o;
            window.__paddleEmit = (name) => o.eventCallback({ name });
          },
          Checkout: { open(o) { window.__paddle.opened.push(o); } },
        };`,
    });
  });
  return {
    requested: () => requested,
    calls: () => page.evaluate(() => (window as unknown as { __paddle: PaddleCalls }).__paddle),
    emit: (name: string) =>
      page.evaluate(
        (n) => (window as unknown as { __paddleEmit: (n: string) => void }).__paddleEmit(n),
        name,
      ),
  };
}

async function signedInAdmin(page: Page) {
  const email = uniqueEmail("pay-admin");
  await signUp(page, email);
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
  try {
    await sql`update "user" set role = 'admin' where email = ${email}`;
  } finally {
    await sql.end();
  }
}

test("without a payment link it's a short page that points to pricing and loads no Paddle.js", async ({
  page,
}) => {
  const paddle = await stubPaddle(page);
  const response = await page.goto("/pay");
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Payments for ReceiptOCR");
  await expect(page.getByRole("link", { name: "See plans and pricing" })).toHaveAttribute(
    "href",
    "/pricing",
  );
  expect(await page.locator('meta[name="robots"]').first().getAttribute("content")).toContain(
    "noindex",
  );
  expect(await page.content()).not.toContain(TOKEN);
  expect(paddle.requested()).toBe(0);
});

test("a malformed payment link says so, without Paddle.js or the token", async ({ page }) => {
  const paddle = await stubPaddle(page);
  await page.goto(`/pay?_ptxn=${encodeURIComponent(`${TXN}"><b>x</b>`)}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "This payment link isn't complete",
  );
  expect(await page.content()).not.toContain(TOKEN);
  expect(paddle.requested()).toBe(0);
});

test("in test mode a visitor who isn't an admin gets no checkout, Paddle.js or token", async ({
  page,
}) => {
  const paddle = await stubPaddle(page);
  await page.goto(`/pay?_ptxn=${TXN}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Payments aren't open yet");
  expect(await page.content()).not.toContain(TOKEN);
  expect(paddle.requested()).toBe(0);
});

test("a payment link opens Paddle's overlay for its transaction, and handles close and success", async ({
  page,
}) => {
  await signedInAdmin(page);
  const paddle = await stubPaddle(page);
  await page.goto(`/pay?_ptxn=${TXN}`);
  await expect(page.getByText("Test mode: no real charge")).toBeVisible();
  await expect.poll(async () => (await paddle.calls())?.opened.length).toBe(1);

  const calls = await paddle.calls();
  expect(paddle.requested()).toBe(1);
  expect(calls.environment).toEqual(["sandbox"]);
  expect(calls.init?.token).toBe(TOKEN);
  expect(calls.init?.checkout?.settings).toMatchObject({ displayMode: "overlay", theme: "dark" });
  expect(calls.opened[0]).toMatchObject({
    transactionId: TXN,
    settings: { displayMode: "overlay", theme: "dark", allowLogout: false },
  });

  // Closed without paying: say so, focus the heading, offer to reopen.
  await paddle.emit("checkout.closed");
  const closed = page.getByRole("heading", { name: "Checkout closed" });
  await expect(closed).toBeFocused();
  await expect(page.getByText("Nothing was charged.")).toBeVisible();
  await page.getByRole("button", { name: "Open the checkout again" }).click();
  await expect.poll(async () => (await paddle.calls()).opened.length).toBe(2);

  // Paid, then Paddle's success screen is closed: the thank-you stays.
  await paddle.emit("checkout.completed");
  await paddle.emit("checkout.closed");
  await expect(page.getByRole("heading", { name: "Thanks, that's done" })).toBeFocused();
  await expect(page.getByRole("link", { name: "Open ReceiptOCR" })).toHaveAttribute("href", "/app");
});

test("Paddle.js blocked: the page says how to get the checkout", async ({ page }) => {
  await signedInAdmin(page);
  await page.route("https://cdn.paddle.com/**", (route) => route.abort("blockedbyclient"));
  await page.goto(`/pay?_ptxn=${TXN}`);
  await expect(page.getByRole("heading", { name: "Checkout couldn't load" })).toBeVisible();
  await expect(page.getByText(/Turn off content blockers/)).toBeVisible();
});
