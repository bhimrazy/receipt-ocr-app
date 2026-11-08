import { expect, test, type Page } from "@playwright/test";
import postgres from "postgres";
import { signUp, uniqueEmail, verifiedAdmin } from "./helpers";

/** The shell must be the whole document: nothing may sit below it, and the canvas must match the page. */
async function expectShellFillsDocument(page: Page, path: string) {
  await page.goto(path);
  await expect(page.locator("#main-content")).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  const m = await page.evaluate(() => {
    const root = document.querySelector("#main-content")!.closest(".min-h-dvh")!;
    return {
      shellBottom: root.getBoundingClientRect().bottom + window.scrollY,
      docHeight: document.documentElement.scrollHeight,
      canvas: getComputedStyle(document.documentElement).backgroundColor,
      page: getComputedStyle(document.body).backgroundColor,
    };
  });
  expect(Math.abs(m.shellBottom - m.docHeight)).toBeLessThanOrEqual(1);
  expect(m.canvas).toBe(m.page);
}

for (const scheme of ["dark", "light"] as const) {
  test(`admin and app shells end with the document (${scheme})`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.emulateMedia({ colorScheme: scheme });
    const email = uniqueEmail("shell");
    await signUp(page, email);
    const db = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
    try {
      await db`update "user" set role = 'admin' where email = ${email}`;
    } finally {
      await db.end();
    }
    await verifiedAdmin(page, email);
    await expectShellFillsDocument(page, "/admin");
    await expectShellFillsDocument(page, "/app");
  });
}
