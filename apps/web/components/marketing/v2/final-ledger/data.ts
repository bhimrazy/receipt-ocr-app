import type { ReceiptCategory } from "@receipt-ocr/ai/categories";
import { faqs as sharedFaqs, freePlan } from "../../content";

/*
 * Demo data for Final · Ledger. Categories come from RECEIPT_CATEGORIES, confidence tiers from
 * lib/format.ts (>= 90 High, >= 75 Check, else Review) and statuses from
 * components/receipt-status.tsx, so the drawn product matches what the app shows. Confidence
 * exists per receipt and per line item only, as in the extraction schema.
 */

export type Tier = "high" | "check" | "review";

export function tier(score: number): Tier {
  if (score >= 90) return "high";
  if (score >= 75) return "check";
  return "review";
}

export const usd = (n: number) => `$${n.toFixed(2)}`;

export type SampleItem = {
  name: string;
  /** As printed on the paper. */
  printed: string;
  qty: number;
  price: number;
  confidence: number;
};

export type Sample = {
  id: "office" | "coffee" | "dinner";
  label: string;
  /** Toolbar label below sm. */
  shortLabel: string;
  fileName: string;
  merchant: string;
  /** Merchant as printed at the top of the paper. */
  printedMerchant: string;
  address: string;
  date: string;
  isoDate: string;
  time: string;
  category: ReceiptCategory;
  items: SampleItem[];
  subtotal: number;
  tax: number;
  tip: number | null;
  /** Tip written in by hand on the paper. */
  handwrittenTip?: boolean;
  total: number;
  confidence: number;
  footer: string;
};

/** Every sample adds up: items = subtotal, subtotal + tax + tip = total. */
export const samples: Sample[] = [
  {
    id: "office",
    label: "Office supplies",
    shortLabel: "Office",
    fileName: "IMG_2046.jpg",
    merchant: "Paper & Co. Office Supply",
    printedMerchant: "PAPER & CO.",
    address: "214 MARKET ST",
    date: "Oct 28, 2026",
    isoDate: "2026-10-28",
    time: "14:06",
    category: "Office",
    items: [
      { name: "A5 notebook", printed: "2x A5 NOTEBOOK", qty: 2, price: 12, confidence: 98 },
      { name: "Gel pens, 12 pack", printed: "GEL PENS 12PK", qty: 1, price: 8.49, confidence: 97 },
      { name: "USB-C cable 2m", printed: "USB-C CBL 2M", qty: 1, price: 14.99, confidence: 61 },
      { name: "Printer paper", printed: "PRINTER PAPER", qty: 1, price: 9.79, confidence: 95 },
      { name: "Desk lamp", printed: "DESK LAMP", qty: 1, price: 34.5, confidence: 99 },
    ],
    subtotal: 79.77,
    tax: 7.08,
    tip: null,
    total: 86.85,
    confidence: 92,
    footer: "VISA •••• 4417 · APPROVED",
  },
  {
    id: "coffee",
    label: "Coffee",
    shortLabel: "Coffee",
    fileName: "IMG_2041.jpg",
    merchant: "Bluebird Café",
    printedMerchant: "BLUEBIRD CAFÉ",
    address: "412 LARCH ST",
    date: "Oct 26, 2026",
    isoDate: "2026-10-26",
    time: "08:12",
    category: "Meals",
    items: [
      { name: "Oat flat white", printed: "OAT FLAT WHITE", qty: 1, price: 4.75, confidence: 98 },
      { name: "Almond croissant", printed: "ALMOND CROISS", qty: 1, price: 4.25, confidence: 95 },
      { name: "Cold brew 16oz", printed: "COLD BREW 16", qty: 1, price: 5.5, confidence: 93 },
    ],
    subtotal: 14.5,
    tax: 1.29,
    tip: 2,
    total: 17.79,
    confidence: 96,
    footer: "THANK YOU · SEE YOU SOON",
  },
  {
    id: "dinner",
    label: "Client dinner",
    shortLabel: "Dinner",
    fileName: "dinner-friday.heic",
    merchant: "Osteria Lume",
    printedMerchant: "OSTERIA LUME",
    address: "19 HARBOR AVE",
    date: "Oct 22, 2026",
    isoDate: "2026-10-22",
    time: "21:30",
    category: "Meals",
    items: [
      { name: "Burrata", printed: "BURRATA", qty: 1, price: 14, confidence: 97 },
      { name: "Cacio e pepe", printed: "2x CACIO E PEPE", qty: 2, price: 38, confidence: 96 },
      { name: "Branzino", printed: "BRANZINO", qty: 1, price: 31, confidence: 95 },
      { name: "House red, glass", printed: "2x HSE RED GL", qty: 2, price: 24, confidence: 84 },
    ],
    subtotal: 107,
    tax: 9.5,
    tip: 21.4,
    handwrittenTip: true,
    total: 137.9,
    confidence: 91,
    footer: "GRAZIE · TABLE 7",
  },
];

/** The most line items any sample has: the demo reserves this many rows so it never resizes. */
export const MAX_ITEMS = Math.max(...samples.map((s) => s.items.length));

/** Rows already in the sample export, below whatever the demo adds. */
export const earlierRows = [
  { merchant: "Metro Transit", isoDate: "2026-10-20", category: "Travel", total: 45 },
  { merchant: "Fiber Net", isoDate: "2026-10-18", category: "Utilities", total: 79.99 },
];

/** The reveal order for one run; the paper highlights the line each step reads. */
export function stepsFor(sample: Sample): string[] {
  return [
    "merchant",
    "date",
    ...sample.items.map((_, i) => `item-${i}`),
    "subtotal",
    "tax",
    "tip",
    "total",
    "category",
    "row",
  ];
}

export type HistoryRow =
  | {
      status: "done";
      merchant: string;
      date: string;
      category: string;
      confidence: number;
      /** Line items in the review tier. */
      toCheck?: number;
      total: string;
      /** Also shown in the shorter phone list. */
      mobile?: boolean;
    }
  | { status: "reading" | "failed"; file: string; uploaded: string; mobile?: boolean };

export const history: HistoryRow[] = [
  { status: "reading", file: "IMG_2047.jpg", uploaded: "Just now", mobile: true },
  {
    status: "done",
    merchant: "Paper & Co. Office Supply",
    date: "Oct 28, 2026",
    category: "Office",
    confidence: 92,
    toCheck: 1,
    total: "$86.85",
    mobile: true,
  },
  {
    status: "done",
    merchant: "Bluebird Café",
    date: "Oct 26, 2026",
    category: "Meals",
    confidence: 96,
    total: "$17.79",
  },
  {
    status: "done",
    merchant: "Metro Transit",
    date: "Oct 24, 2026",
    category: "Travel",
    confidence: 99,
    total: "$45.00",
  },
  { status: "failed", file: "IMG_2039.heic", uploaded: "Oct 23, 2026", mobile: true },
  {
    status: "done",
    merchant: "Osteria Lume",
    date: "Oct 22, 2026",
    category: "Meals",
    confidence: 84,
    total: "$137.90",
  },
];

/** CSV preview; column names are a subset of lib/csv.ts receiptsToCsv, in its order. */
export const csvHeader = ["merchant", "receipt_date", "category", "currency", "tax", "total"];
export const csvRows = [
  ["Paper & Co. Office Supply", "2026-10-28", "Office", "USD", "7.08", "86.85"],
  ["Bluebird Café", "2026-10-26", "Meals", "USD", "1.29", "17.79"],
  ["Metro Transit", "2026-10-24", "Travel", "USD", "0.00", "45.00"],
  ["Osteria Lume", "2026-10-22", "Meals", "USD", "9.50", "137.90"],
];

export const plan = freePlan;

/** The data-access answer carries the admin-support caveat the shared copy leaves out. */
export const faqs = sharedFaqs.map((faq) =>
  faq.q === "Who can see my receipts?"
    ? {
        q: faq.q,
        a: "You and the people you invite to your workspace. receiptOCR admins access an account only to handle a support request. Images are read by Google's Gemini AI to extract the data. You can delete any receipt, or your whole account, from Settings.",
      }
    : faq.q === "What are the limits on the free plan?"
      ? {
          q: faq.q,
          a: `Up to ${freePlan.receiptsPerDay} receipts a day, resetting at 00:00 UTC and subject to a service-wide daily cap, and ${freePlan.workspaces} workspace. Need more? Contact us and we'll set you up.`,
        }
      : faq,
);
