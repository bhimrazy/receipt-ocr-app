import { expect, test, type Browser } from "@playwright/test";
import postgres from "postgres";
import { signUp, uniqueEmail } from "./helpers";

async function sql<T>(run: (db: postgres.Sql) => Promise<T>) {
  const db = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
  try {
    return await run(db);
  } finally {
    await db.end();
  }
}

const freshContext = (browser: Browser) =>
  browser.newContext({
    extraHTTPHeaders: {
      "x-forwarded-for": `10.${(Math.random() * 255) | 0}.${(Math.random() * 255) | 0}.${(Math.random() * 255) | 0}`,
    },
  });

async function adminPage(browser: Browser) {
  const context = await freshContext(browser);
  const page = await context.newPage();
  const email = uniqueEmail("ops-admin");
  await signUp(page, email);
  await sql((db) => db`update "user" set role = 'admin' where email = ${email}`);
  return { email, page };
}

/** A failed receipt with its round, one failed call and a dead job, as the queue leaves them. */
async function seedDeadJob(email: string) {
  return sql(async (db) => {
    const [owner] = await db<{ user_id: string; organization_id: string }[]>`
      select u.id as user_id, m.organization_id from "user" u
      join member m on m.user_id = u.id where u.email = ${email} limit 1`;
    const [receipt] = await db<{ id: string }[]>`
      insert into receipts (organization_id, user_id, status, error_message)
      values (${owner!.organization_id}, ${owner!.user_id}, 'failed', 'We could not read this receipt.')
      returning id`;
    const payload = {
      receiptId: receipt!.id,
      organizationId: owner!.organization_id,
      userId: owner!.user_id,
      round: 1,
    };
    await db`insert into ocr_rounds (receipt_id, organization_id, user_id, round)
      values (${receipt!.id}, ${owner!.organization_id}, ${owner!.user_id}, 1)`;
    await db`insert into ocr_calls (receipt_id, organization_id, user_id, round, step, model, provider, status, latency_ms)
      values (${receipt!.id}, ${owner!.organization_id}, ${owner!.user_id}, 1, 0, 'fixture', 'fixture', 'timeout', 50000)`;
    const [job] = await db<{ id: string }[]>`
      insert into jobs (kind, state, payload, receipt_id, organization_id, user_id, attempts, max_attempts,
        last_error_kind, finished_at, attempt_log)
      values ('receipt.extract', 'dead', ${db.json(payload)}, ${receipt!.id}, ${owner!.organization_id},
        ${owner!.user_id}, 4, 4, 'timeout', now(),
        ${db.json([{ n: 4, at: new Date().toISOString(), outcome: "dead", kind: "timeout", worker: "e2e", ms: 50000 }])})
      returning id`;
    return job!.id;
  });
}

test("operations page shows KPIs and charts, keeps the range in the URL, and has data tables", async ({
  browser,
}) => {
  const { page } = await adminPage(browser);
  await page.goto("/admin");
  await page.getByRole("link", { name: "Operations" }).first().click();
  await expect(page.getByRole("heading", { level: 1, name: "Operations" })).toBeVisible();
  for (const label of ["Reads", "Success rate", "Latency p95", "Estimated cost", "Queue depth"]) {
    await expect(page.getByText(label, { exact: true }).first()).toBeVisible();
  }
  await expect(page.getByRole("status").getByText(/Updated .* UTC/)).toBeVisible();

  await page
    .getByRole("navigation", { name: "Time range" })
    .getByRole("link", { name: "7 days" })
    .click();
  await expect(page).toHaveURL(/range=7d/);
  await page.getByRole("link", { name: "Compare with previous period" }).click();
  await expect(page).toHaveURL(/range=7d&compare=1/);
  await expect(page.getByText("Previous period").first()).toBeVisible();

  const reads = page.getByRole("figure").filter({ hasText: "Reads" }).first();
  await reads.getByText("Show data").click();
  await expect(reads.getByRole("table", { name: "Reads by outcome" })).toBeVisible();

  // A bad range falls back to the default instead of erroring.
  await page.goto("/admin/operations?range=1y");
  await expect(page.getByRole("link", { name: "24 hours" })).toHaveAttribute(
    "aria-current",
    "page",
  );

  // No sideways scroll on a phone.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/admin/operations");
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});

test("admin finds a dead job, re-runs it with a reason, and it is audited", async ({ browser }) => {
  const { email, page } = await adminPage(browser);
  const jobId = await seedDeadJob(email);

  await page.goto(`/admin/jobs?state=dead&q=${encodeURIComponent(email)}`);
  await expect(page.getByRole("heading", { level: 1, name: "Jobs" })).toBeVisible();
  await page.getByRole("link", { name: jobId.slice(0, 8) }).click();
  await expect(page).toHaveURL(`/admin/jobs/${jobId}`);
  await expect(page.getByText("Failed for good · Timed out")).toBeVisible();
  // Metadata only: no receipt image or extracted fields on this page.
  await expect(page.locator("img")).toHaveCount(0);

  const reason = `Provider outage ${Date.now()}`;
  await page.getByRole("button", { name: "Re-run job" }).click();
  const dialog = page.getByRole("dialog", { name: "Re-run this job?" });
  await dialog.getByLabel("Reason").fill(reason);
  await dialog.getByRole("button", { name: "Re-run job" }).click();
  await expect(dialog).toBeHidden();

  const audit = page.getByRole("region", { name: "Admin actions on this job" });
  await expect(audit.getByText("Re-ran job")).toBeVisible();
  await expect(audit.getByText(reason)).toBeVisible();
  const rows = await sql(
    (db) => db<{ n: number }[]>`select count(*)::int as n from ocr_rounds where receipt_id =
      (select receipt_id from jobs where id = ${jobId})`,
  );
  expect(rows[0]!.n).toBe(1);

  await page.goto(`/admin/audit?q=${encodeURIComponent(reason)}`);
  await expect(page.getByText("Re-ran job")).toBeVisible();
});

test("non-admins get a 404 on the operations and jobs pages", async ({ browser }) => {
  const context = await freshContext(browser);
  const page = await context.newPage();
  await signUp(page, uniqueEmail("ops-user"));
  for (const path of ["/admin/operations", "/admin/jobs"]) {
    const response = await page.goto(path);
    expect(response?.status()).toBe(404);
  }
});
