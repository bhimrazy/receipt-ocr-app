// Renders the install-dialog screenshots in apps/web/public/screenshots from test data: a new
// account with made-up receipts, captured from a running app in the dark theme. Re-run after a
// visible change to Home or the receipt screen, and commit the PNGs:
//
//   DATABASE_URL=… bun run screenshots:manifest [http://localhost:3004]
//
// Needs the compose stack and `next start` with AUTH_REQUIRE_EMAIL_VERIFICATION=false (scripts/test.sh
// sets both up). Writes straight to that database; use a throwaway one.
import { mkdirSync } from "node:fs";
import path from "node:path";
import { type Browser, chromium } from "@playwright/test";
import { S3Client, SQL } from "bun";
import {
  type ManifestScreen,
  manifestScreenshots,
  screenshotFile,
} from "../apps/web/lib/manifest-screenshots";
import { receiptObjectKey } from "../packages/storage/src/index";

// apps/web/lib/security-prompt.ts, which is server-only.
const SECURITY_PROMPT_COOKIE = "receiptocr_security_prompt";

const base = process.argv[2] ?? "http://localhost:3004";
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("manifest-screenshots: set DATABASE_URL to the app's (throwaway) database");
  process.exit(2);
}
const outDir = path.resolve(import.meta.dirname, "../apps/web/public/screenshots");

const email = `screens-${Date.now()}@example.com`;
const password = "screens-password-123";

// Made-up shops; one low-confidence scan so Home has something to check.
const day = (n: number) => {
  const d = new Date();
  d.setUTCDate(Math.max(1, d.getUTCDate() - n));
  return d.toISOString().slice(0, 10);
};
const receipts = [
  {
    merchant: "Green Leaf Market",
    date: day(0),
    category: "Groceries",
    tax: 2.94,
    confidence: 0.97,
    items: [
      ["Organic Bananas", 1, 2.49],
      ["Almond Milk", 2, 4.99],
      ["Sourdough Loaf", 1, 5.49],
      ["Free-range Eggs", 1, 6.79],
      ["Cold Brew", 3, 3.99],
    ],
  },
  {
    merchant: "Riverside Cafe",
    date: day(1),
    category: "Meals",
    tax: 1.02,
    confidence: 0.95,
    items: [
      ["Flat White", 2, 4.75],
      ["Croissant", 1, 2.0],
    ],
  },
  {
    merchant: "Metro Fuel",
    date: day(2),
    category: "Fuel",
    tax: 4.8,
    confidence: 0.68,
    items: [["Unleaded 32.5 L", 1, 55.2]],
  },
  {
    merchant: "Paper and Pen Supply",
    date: day(4),
    category: "Office",
    tax: 3.47,
    confidence: 0.93,
    items: [
      ["Printer Paper A4", 2, 9.5],
      ["Toner Cartridge", 1, 23.0],
    ],
  },
  {
    merchant: "Harbor Pharmacy",
    date: day(6),
    category: "Health",
    tax: 0.88,
    confidence: 0.96,
    items: [["Vitamin D", 1, 10.99]],
  },
] as const;

async function signUp() {
  const res = await fetch(new URL("/api/auth/sign-up/email", base), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: base,
      "x-forwarded-for": `10.9.${(Math.random() * 255) | 0}.${((Math.random() * 254) | 0) + 1}`,
    },
    body: JSON.stringify({ name: "Sam", email, password }),
  });
  if (!res.ok) throw new Error(`sign-up failed: HTTP ${res.status}`);
}

const money = (n: number) => n.toFixed(2);

/** A paper receipt for `r`, drawn as HTML: the photo the receipt screen shows. */
function receiptHtml(r: (typeof receipts)[number]) {
  const subtotal = r.items.reduce((sum, [, qty, price]) => sum + qty * price, 0);
  const rows = r.items
    .map(([name, qty, price]) => `<tr><td>${qty} ${name}</td><td>${money(qty * price)}</td></tr>`)
    .join("");
  return `<!doctype html><html><head><style>
html,body{margin:0;background:#3f3f46}
.p{width:420px;margin:40px auto;padding:36px 32px;background:#fafaf7;color:#1c1c1c;
font:16px/1.6 "DejaVu Sans Mono",monospace;box-shadow:0 8px 30px #0006}
h1{font-size:22px;text-align:center;margin:0 0 4px}.c{text-align:center;color:#555;margin:0 0 20px}
table{width:100%;border-collapse:collapse}td:last-child{text-align:right}
.t td{border-top:1px dashed #999;padding-top:8px}.g td{font-weight:bold;font-size:18px}
</style></head><body><div class="p"><h1>${r.merchant.toUpperCase()}</h1>
<p class="c">${r.date} 18:42</p><table>${rows}
<tr class="t"><td>SUBTOTAL</td><td>${money(subtotal)}</td></tr>
<tr><td>TAX</td><td>${money(r.tax)}</td></tr>
<tr class="g"><td>TOTAL</td><td>${money(subtotal + r.tax)}</td></tr></table>
<p class="c" style="margin-top:24px">THANK YOU</p></div></body></html>`;
}

/** Inserts the receipts into the account's workspace; the first one gets a photo. */
async function seed(browser: Browser) {
  const sql = new SQL(databaseUrl!);
  try {
    const [owner] = await sql`
      select u.id as user_id, m.organization_id
      from "user" u join member m on m.user_id = u.id
      where u.email = ${email} limit 1`;
    if (!owner) throw new Error(`no workspace for ${email}`);
    const ids: string[] = [];
    for (const r of receipts) {
      const subtotal = r.items.reduce((sum, [, qty, price]) => sum + qty * price, 0);
      const [row] = await sql`
        insert into receipts (organization_id, user_id, merchant, receipt_date, category,
                              currency, subtotal, tax, total, confidence, status)
        values (${owner.organization_id}, ${owner.user_id}, ${r.merchant}, ${r.date},
                ${r.category}, 'USD', ${subtotal.toFixed(2)}, ${r.tax.toFixed(2)},
                ${(subtotal + r.tax).toFixed(2)}, ${r.confidence}, 'completed')
        returning id`;
      for (const [name, qty, price] of r.items) {
        await sql`insert into receipt_items (receipt_id, name, quantity, unit_price, total_price)
                  values (${row.id}, ${name}, ${qty}, ${price.toFixed(2)}, ${(qty * price).toFixed(2)})`;
      }
      ids.push(row.id);
    }

    const page = await browser.newPage({ viewport: { width: 500, height: 760 } });
    await page.setContent(receiptHtml(receipts[0]));
    const photo = await page.screenshot({ fullPage: true });
    await page.close();
    const key = receiptObjectKey(owner.user_id, ids[0]!, "image/png");
    await s3.write(key, photo, { type: "image/png" });
    await sql`update receipts set image_object_key = ${key}, file_name = 'receipt.png'
              where id = ${ids[0]!}`;
    return { userId: owner.user_id as string, receiptId: ids[0]! };
  } finally {
    await sql.close();
  }
}

const s3 = new S3Client({
  endpoint: process.env.S3_ENDPOINT,
  region: process.env.S3_REGION,
  bucket: process.env.S3_BUCKET,
  accessKeyId: process.env.S3_ACCESS_KEY_ID,
  secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
});

mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch();
try {
  await signUp();
  const { userId, receiptId } = await seed(browser);
  const urls: Record<ManifestScreen, string> = {
    home: "/app",
    receipt: `/app/receipts/${receiptId}`,
  };

  for (const shot of manifestScreenshots) {
    const narrow = shot.formFactor === "narrow";
    const context = await browser.newContext({
      viewport: { width: shot.width, height: shot.height },
      deviceScaleFactor: shot.dpr,
      colorScheme: "dark",
      isMobile: narrow,
      hasTouch: narrow,
    });
    await context.addInitScript(() => {
      localStorage.setItem("theme", "dark");
      localStorage.setItem("receiptocr:security-nudge-dismissed", String(Date.now()));
    });
    const res = await context.request.post(new URL("/api/auth/sign-in/email", base).href, {
      data: { email, password },
      headers: { origin: base },
    });
    if (!res.ok()) throw new Error(`sign-in failed: HTTP ${res.status()}`);
    // The one-time "protect your receipts" card, closed as its button would.
    await context.addCookies([{ name: SECURITY_PROMPT_COOKIE, value: userId, url: base }]);
    const page = await context.newPage();
    await page.goto(new URL(urls[shot.screen], base).href, { waitUntil: "networkidle" });
    await page.waitForTimeout(500); // entrance animations
    const file = screenshotFile(shot);
    await page.screenshot({ path: path.join(outDir, file) });
    console.log(`wrote apps/web/public/screenshots/${file}`);
    await context.close();
  }
} finally {
  await browser.close();
}
