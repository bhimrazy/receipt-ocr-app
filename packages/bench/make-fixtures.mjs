// Renders the synthetic receipts in packages/bench/fixtures: <id>.png plus <id>.json ground truth.
//   bun packages/bench/make-fixtures.mjs        (needs `bunx playwright install chromium`)
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
    // The trading name without the company suffix is what the prompt asks for; both are right.
    otherNames: ["Himalayan Electronics"],
    place: "New Road, Kathmandu",
    date: ["2026-09-14", "14/09/2026"],
    // Electronics: Equipment by the category descriptions; Supplies is a fair reading too.
    category: ["Equipment", "Supplies"],
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
    category: "Meals",
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
    category: "Meals",
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
    id: "kwd-three-decimals",
    merchant: "Al Mubarakiya Cafe",
    place: "Block 4, Salmiya, Kuwait",
    date: ["2026-10-12", "12/10/2026"],
    category: "Meals",
    currency: "KWD",
    suffix: " KD",
    fmt: (n) => group3(n, ",", ".", 3),
    tax: 0,
    items: items([
      ["Chicken Machboos", 2, 1.75],
      ["Karak Tea", 3, 0.25],
      ["Lamb Samosa", 4, 0.125],
      ["Fresh Lime", 2, 0.85],
    ]),
  },
  {
    id: "usd-tip",
    merchant: "Blue Door Bistro",
    place: "418 Market St, Portland OR",
    date: ["2026-10-21", "10/21/2026"],
    category: "Meals",
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
    category: "Groceries",
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

// Nepal bills for extraction v3: dates in either calendar, numbers that sit near the bill number, service charge,
// discount and rounding. Invented merchants, 9990000xx PANs and 01-4000000 phones. Latin script only: the
// renderer has no Devanagari font, so a Devanagari line would come out as boxes. Every one is "uploaded" on
// UPLOAD_DAY, so the stored date and its review reasons are reproducible.
const UPLOAD_DAY = "2026-11-10";
const nepal = (receipt) => ({
  category: "Meals",
  currency: "NPR",
  prefix: "Rs ",
  fmt: lakh,
  tax: 0.13,
  taxLabel: "VAT 13%",
  uploadDay: UPLOAD_DAY,
  ...receipt,
});
const printed = (text, label, calendar = null, role = "transaction") => ({
  text,
  label,
  calendar,
  role,
});
const tea = items([
  ["Chicken Momo", 2, 280],
  ["Masala Tea", 3, 90],
]);

receipts.push(
  nepal({
    id: "npr-bs-only",
    merchant: "Example Thakali Kitchen",
    place: "Lazimpat, Kathmandu",
    head: [
      ["PAN No", "999000011"],
      ["Bill No", "2041"],
      ["Miti", "15/07/2082"],
    ],
    dates: [printed("15/07/2082", "Miti", "bikram-sambat")],
    date: ["2025-11-01"],
    truth: {
      receiptDateCalendar: "bikram-sambat",
      invoiceNumber: "2041",
      merchantTaxId: "999000011",
    },
    items: items([
      ["Thakali Khana Set", 2, 450],
      ["Sweet Lassi", 2, 150],
    ]),
  }),
  nepal({
    id: "npr-ad-only",
    merchant: "Example Hardware Suppliers",
    place: "Teku, Kathmandu",
    category: ["Supplies", "Equipment"],
    head: [
      ["VAT No", "999000012"],
      ["Invoice No", "INV-0388"],
      ["Date", "21/10/2026"],
    ],
    dates: [printed("21/10/2026", "Date")],
    date: ["2026-10-21"],
    truth: {
      receiptDateCalendar: "gregory",
      invoiceNumber: "INV-0388",
      merchantTaxId: "999000012",
    },
    items: items([
      ["PVC Pipe 1in", 6, 320],
      ["Wall Putty 20kg", 1, 1450],
    ]),
  }),
  nepal({
    id: "npr-ad-miti-agree",
    merchant: "Example Momo Corner",
    place: "Jhamsikhel, Lalitpur",
    head: [
      ["Bill No", "5520"],
      ["Date", "10/21/2026"],
      ["Miti", "04/07/2083"],
    ],
    dates: [printed("10/21/2026", "Date"), printed("04/07/2083", "Miti", "bikram-sambat")],
    date: ["2026-10-21"],
    truth: { receiptDateCalendar: "bikram-sambat", invoiceNumber: "5520" },
    items: tea,
  }),
  nepal({
    id: "npr-ad-miti-conflict",
    merchant: "Example Bakery Cafe",
    place: "Baneshwor, Kathmandu",
    head: [
      ["Bill No", "5521"],
      ["Date", "10/21/2026"],
      ["Miti", "09/07/2083"],
    ],
    dates: [printed("10/21/2026", "Date"), printed("09/07/2083", "Miti", "bikram-sambat")],
    // The Miti is five days after the AD date: an NPR bill keeps the Miti's day, and is flagged.
    date: ["2026-10-26"],
    truth: {
      receiptDateCalendar: "bikram-sambat",
      invoiceNumber: "5521",
      reviewReasons: ["date_conflict"],
    },
    items: tea,
  }),
  nepal({
    id: "npr-ambiguous-date",
    merchant: "Example Tea House",
    place: "Pokhara",
    head: [["Date", "05/06/2026"]],
    dates: [printed("05/06/2026", "Date")],
    // 5 June or 6 May: either is stored, and it must be flagged.
    date: [undefined],
    truth: { receiptDateCalendar: "gregory", reviewReasons: ["date_ambiguous"] },
    items: tea,
  }),
  nepal({
    id: "npr-pan-bill",
    merchant: "Example Newari Bhojanalaya",
    place: "Patan Durbar Square, Lalitpur",
    head: [
      ["PAN", "999000021"],
      ["Phone", "01-4000000"],
      ["Bill No", "7311"],
      ["Table No", "12"],
      ["KOT No", "88"],
      ["Date", "2026-10-30"],
    ],
    dates: [printed("2026-10-30", "Date")],
    date: ["2026-10-30"],
    truth: {
      receiptDateCalendar: "gregory",
      invoiceNumber: "7311",
      merchantTaxId: "999000021",
      reviewReasons: [],
    },
    items: items([
      ["Samay Baji", 2, 380],
      ["Bara", 4, 120],
      ["Aila 1/4", 1, 650],
    ]),
  }),
  nepal({
    id: "npr-service-charge",
    merchant: "Example Rooftop Restaurant",
    place: "Thamel, Kathmandu",
    head: [
      ["PAN/VAT No", "999000031"],
      ["Bill No", "SC-1101-83/84"],
      ["Date", "2026/10/18"],
    ],
    dates: [printed("2026/10/18", "Date")],
    date: ["2026-10-18"],
    serviceRate: 0.1,
    truth: {
      receiptDateCalendar: "gregory",
      invoiceNumber: "SC-1101-83/84",
      merchantTaxId: "999000031",
      reviewReasons: [],
    },
    items: items([
      ["Dal Bhat Set", 2, 595],
      ["Fresh Lime Soda", 2, 220],
    ]),
  }),
  nepal({
    id: "npr-rounded-total",
    merchant: "Example Mart",
    place: "Chabahil, Kathmandu",
    category: "Groceries",
    head: [
      ["VAT No", "999000041"],
      ["Invoice No", "EM-82-00977"],
      ["Miti", "2083/07/02"],
    ],
    dates: [printed("2083/07/02", "Miti", "bikram-sambat")],
    date: ["2026-10-19"],
    discountRate: 0.05,
    roundTotal: true,
    truth: {
      receiptDateCalendar: "bikram-sambat",
      invoiceNumber: "EM-82-00977",
      merchantTaxId: "999000041",
      reviewReasons: [],
    },
    items: items([
      ["Basmati Rice 5kg", 1, 950],
      ["Sunflower Oil 1L", 1, 250],
    ]),
  }),
);

const row = (label, value, cls = "row") =>
  `<div class="${cls}"><span>${label}</span><span>${value}</span></div>`;
const html = (r, t) => `<!doctype html><meta charset="utf-8"><style>
body{margin:0;background:#fff}
.r{width:420px;box-sizing:border-box;padding:24px 20px;font:13px/1.45 "Courier New",monospace;color:#111;background:#fff}
h1{font-size:16px;text-align:center;margin:0}.c{text-align:center;color:#444}
.row{display:flex;justify-content:space-between;gap:8px}hr{border:0;border-top:1px dashed #444;margin:10px 0}
.b{font-weight:bold;font-size:15px}</style><div class="r">
<h1>${r.merchant}</h1><div class="c">${r.place}</div>${
  r.head
    ? `<hr>${r.head.map(([label, value]) => row(`${label}:`, value)).join("")}`
    : `<div class="c">${r.date[1]}</div>`
}<hr>
${r.items
  .map(
    (i) =>
      `<div class="row"><span>${i.name}</span><span>${i.quantity} x ${m(r, i.unitPrice)} = ${m(r, i.totalPrice)}</span></div>`,
  )
  .join("")}<hr>
${row("Subtotal", m(r, t.subtotal))}
${t.discount ? row(`Discount ${r.discountRate * 100}%`, `-${m(r, t.discount)}`) : ""}
${t.serviceCharge ? row(`Service Charge ${r.serviceRate * 100}%`, m(r, t.serviceCharge)) : ""}
${row(r.taxLabel ?? "Tax", m(r, t.tax))}
${t.tip ? row("Tip", m(r, t.tip)) : ""}
${t.roundOff ? row("Round Off", m(r, t.roundOff)) : ""}
${row(r.head ? "GRAND TOTAL" : "TOTAL", m(r, t.total), "row b")}<hr><div class="c">Thank you!</div></div>`;
const m = (r, n) => `${n < 0 ? "-" : ""}${r.prefix ?? ""}${r.fmt(Math.abs(n))}${r.suffix ?? ""}`;
const round = (n) => Math.round(n * 100) / 100;

// `bun make-fixtures.mjs npr-bs-only npr-pan-bill` renders only those, so the others' PNGs stay byte for byte.
const only = process.argv.slice(2);
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 420, height: 400 } });
  for (const r of receipts.filter(({ id }) => only.length === 0 || only.includes(id))) {
    const subtotal = round(r.items.reduce((s, i) => s + i.totalPrice, 0));
    const discount = r.discountRate ? round(subtotal * r.discountRate) : null;
    const serviceCharge = r.serviceRate ? round(subtotal * r.serviceRate) : null;
    // Nepal VAT is charged on the amount after discount and service charge.
    const tax = round((subtotal - (discount ?? 0) + (serviceCharge ?? 0)) * r.tax);
    const tip = r.tipRate ? round(subtotal * r.tipRate) : null;
    const exact = round(subtotal - (discount ?? 0) + (serviceCharge ?? 0) + tax + (tip ?? 0));
    const total = r.roundTotal ? Math.round(exact) : exact;
    const roundOff = r.roundTotal ? round(total - exact) : null;
    await page.setContent(
      html(r, { subtotal, discount, serviceCharge, tax, tip, roundOff, total }),
    );
    const png = await page.locator(".r").screenshot({ type: "png" });
    writeFileSync(path.join(dir, `${r.id}.png`), png);
    const v3 = r.head
      ? {
          receiptDateCalendar: r.truth.receiptDateCalendar,
          invoiceNumber: r.truth.invoiceNumber ?? null,
          merchantTaxId: r.truth.merchantTaxId ?? null,
        }
      : {};
    const truth = {
      merchant: r.otherNames ? [r.merchant, ...r.otherNames] : r.merchant,
      receiptDate: r.date[0],
      ...v3,
      category: r.category,
      currency: r.currency,
      subtotal,
      ...(r.head ? { discount, serviceCharge } : {}),
      tax,
      tip,
      total,
      ...(r.truth?.reviewReasons ? { reviewReasons: r.truth.reviewReasons } : {}),
      items: r.items,
      ...(r.head ? { _meta: { uploadDay: r.uploadDay, printedDates: r.dates } } : {}),
    };
    writeFileSync(path.join(dir, `${r.id}.json`), `${JSON.stringify(truth, null, 2)}\n`);
    console.log(`${r.id}: ${(png.length / 1024).toFixed(0)} KB`);
  }
} finally {
  await browser.close();
}
