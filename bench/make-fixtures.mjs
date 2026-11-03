// Renders the synthetic receipts in bench/fixtures: <id>.png plus <id>.json ground truth.
//   bun bench/make-fixtures.mjs        (needs `bunx playwright install chromium`)
import { writeFileSync } from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";

const dir = path.join(import.meta.dirname, "fixtures");

// fmt turns a number into the receipt's own separator style.
const group3 = (n, thousands, decimal, digits) => {
  const [int, frac] = n.toFixed(digits).split(".");
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, thousands);
  return frac ? `${grouped}${decimal}${frac}` : grouped;
};
const lakh = (n) => {
  const [int, frac] = n.toFixed(2).split(".");
  const last3 = int.slice(-3);
  const rest = int.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ",");
  return `${rest ? `${rest},` : ""}${last3}.${frac}`;
};

const items = (rows) =>
  rows.map(([name, quantity, unitPrice]) => ({
    name,
    quantity,
    unitPrice,
    totalPrice: Math.round(quantity * unitPrice * 100) / 100,
  }));

const receipts = [
  {
    id: "npr-lakh",
    merchant: "Himalayan Electronics Pvt. Ltd.",
    place: "New Road, Kathmandu",
    date: ["2026-09-14", "14/09/2026"],
    category: "Shopping",
    currency: "NPR",
    prefix: "Rs ",
    fmt: lakh,
    tax: 0.13,
    items: items([
      ["Wireless Router AX3000", 2, 8750],
      ["UPS 650VA", 1, 12400],
      ["Cat6 Cable 50m", 3, 4150],
      ["Laptop Stand", 1, 98_500],
    ]),
  },
  {
    id: "eur-comma",
    merchant: "Bäckerei Sonnenschein",
    place: "Hauptstraße 12, 10115 Berlin",
    date: ["2026-11-04", "04.11.2026"],
    category: "Restaurant",
    currency: "EUR",
    suffix: " €",
    fmt: (n) => group3(n, ".", ",", 2),
    tax: 0.07,
    items: items([
      ["Roggenbrot", 1, 4.5],
      ["Butterbrezel", 4, 1.2],
      ["Käsekuchen Stück", 2, 3.9],
      ["Kaffee groß", 2, 3.2],
    ]),
  },
  {
    id: "idr-dot",
    merchant: "Warung Makan Bahagia",
    place: "Jl. Raya Ubud No. 5, Bali",
    date: ["2026-10-02", "02/10/2026"],
    category: "Restaurant",
    currency: "IDR",
    prefix: "Rp ",
    fmt: (n) => group3(n, ".", ",", 0),
    tax: 0.1,
    items: items([
      ["Nasi Goreng", 2, 31_000],
      ["Es Teh Manis", 3, 8000],
      ["Sate Ayam", 1, 45_000],
      ["Air Mineral", 2, 5000],
    ]),
  },
  {
    id: "usd-tip",
    merchant: "Blue Door Bistro",
    place: "418 Market St, Portland OR",
    date: ["2026-10-21", "10/21/2026"],
    category: "Restaurant",
    currency: "USD",
    prefix: "$",
    fmt: (n) => group3(n, ",", ".", 2),
    tax: 0.0875,
    tipRate: 0.2,
    items: items([
      ["Mushroom Risotto", 1, 22],
      ["Grilled Salmon", 1, 29.5],
      ["House Salad", 2, 9],
      ["Sparkling Water", 2, 4.25],
    ]),
  },
  {
    id: "long-groceries",
    merchant: "Greenfield Market",
    place: "2200 Oak Avenue, Austin TX",
    date: ["2026-10-30", "10/30/2026"],
    category: "Grocery",
    currency: "USD",
    prefix: "$",
    fmt: (n) => group3(n, ",", ".", 2),
    tax: 0.0625,
    items: items(
      Array.from({ length: 34 }, (_, i) => [
        `${["Organic Apples", "Whole Milk 1gal", "Wheat Bread", "Free Range Eggs", "Basmati Rice 2lb", "Olive Oil 500ml", "Cheddar Block", "Baby Spinach", "Greek Yogurt", "Coffee Beans 12oz", "Pasta Penne", "Tomato Sauce", "Bananas", "Chicken Breast", "Frozen Peas"][i % 15]}${i >= 15 ? ` #${i}` : ""}`,
        (i % 3) + 1,
        Math.round((1.25 + ((i * 37) % 900) / 100) * 100) / 100,
      ]),
    ),
  },
];

const html = (r, t) => `<!doctype html><meta charset="utf-8"><style>
body{margin:0;background:#fff}
.r{width:420px;box-sizing:border-box;padding:24px 20px;font:13px/1.45 "Courier New",monospace;color:#111;background:#fff}
h1{font-size:16px;text-align:center;margin:0}.c{text-align:center;color:#444}
.row{display:flex;justify-content:space-between;gap:8px}hr{border:0;border-top:1px dashed #444;margin:10px 0}
.b{font-weight:bold;font-size:15px}</style><div class="r">
<h1>${r.merchant}</h1><div class="c">${r.place}</div><div class="c">${r.date[1]}</div><hr>
${r.items
  .map(
    (i) =>
      `<div class="row"><span>${i.name}</span><span>${i.quantity} x ${m(r, i.unitPrice)} = ${m(r, i.totalPrice)}</span></div>`,
  )
  .join("")}<hr>
<div class="row"><span>Subtotal</span><span>${m(r, t.subtotal)}</span></div>
<div class="row"><span>Tax</span><span>${m(r, t.tax)}</span></div>
${t.tip ? `<div class="row"><span>Tip</span><span>${m(r, t.tip)}</span></div>` : ""}
<div class="row b"><span>TOTAL</span><span>${m(r, t.total)}</span></div><hr><div class="c">Thank you!</div></div>`;
const m = (r, n) => `${r.prefix ?? ""}${r.fmt(n)}${r.suffix ?? ""}`;
const round = (n) => Math.round(n * 100) / 100;

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 420, height: 400 } });
  for (const r of receipts) {
    const subtotal = round(r.items.reduce((s, i) => s + i.totalPrice, 0));
    const tax = round(subtotal * r.tax);
    const tip = r.tipRate ? round(subtotal * r.tipRate) : null;
    const total = round(subtotal + tax + (tip ?? 0));
    await page.setContent(html(r, { subtotal, tax, tip, total }));
    const png = await page.locator(".r").screenshot({ type: "png" });
    writeFileSync(path.join(dir, `${r.id}.png`), png);
    const truth = {
      merchant: r.merchant,
      receiptDate: r.date[0],
      category: r.category,
      currency: r.currency,
      subtotal,
      tax,
      tip,
      total,
      items: r.items,
    };
    writeFileSync(path.join(dir, `${r.id}.json`), `${JSON.stringify(truth, null, 2)}\n`);
    console.log(`${r.id}: ${(png.length / 1024).toFixed(0)} KB`);
  }
} finally {
  await browser.close();
}
