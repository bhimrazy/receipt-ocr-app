import { PLANS } from "@/lib/plans";

/*
 * Marketing copy shared by every landing direction. Each claim here is backed by code today;
 * the source is noted where it isn't obvious, so a change in behaviour is easy to trace back.
 */

const free = PLANS.free;

export const freePlan = {
  name: "Free plan",
  price: "$0",
  // lib/plans.ts: receiptsPerDay, workspaces.
  receiptsPerDay: free.receiptsPerDay,
  workspaces: free.workspaces,
  summary: `${free.receiptsPerDay} receipts a day, ${free.workspaces} workspace. No card needed.`,
  includes: [
    `${free.receiptsPerDay} receipts a day`,
    `${free.workspaces} workspace, with teammates you invite`,
    "Merchant, date, line items, tax and total",
    "Confidence score per receipt and per line item",
    "Edit merchant, date, category, currency and amounts",
    "CSV export, per receipt or everything at once",
  ],
};

/** Not built yet. Only ever shown labelled as coming. */
export const comingSoon = [
  {
    title: "Paid plans",
    desc: "Higher daily limits and more workspaces. Need them now? Contact us.",
  },
  { title: "PDF receipts", desc: "Images only for now." },
  { title: "Bring your own AI key", desc: "Run extraction on your own Google AI key." },
];

/** Hard facts, each enforced in code. */
export const specs: Array<{ label: string; value: string; note: string }> = [
  { label: "Formats", value: "PNG · JPG · HEIC", note: "Photos and scans. PDF is coming." },
  { label: "File size", value: "10 MB", note: "Per image." },
  { label: "Batch upload", value: "20 files", note: "Queued and read one after another." },
  {
    label: "Fields",
    value: "Merchant · date · items · tax · total",
    note: "Plus subtotal, tip, currency and category.",
  },
  {
    label: "Confidence",
    value: "Per receipt + per item",
    note: "Low scores tell you what to check.",
  },
  {
    label: "Export",
    value: "CSV · JSON",
    note: "CSV for any receipt or the whole workspace; copy JSON per receipt.",
  },
  {
    label: "Free plan",
    value: `${free.receiptsPerDay} / day`,
    note: `${free.workspaces} workspace, no card.`,
  },
];

export const faqs = [
  {
    q: "What can I upload?",
    a: "PNG, JPG and HEIC images up to 10 MB each, up to 20 at a time. Take a photo with your phone or drop in a scan. PDF receipts aren't supported yet.",
  },
  {
    q: "How accurate is it?",
    a: "Each receipt gets an overall confidence score, and each line item gets its own. Low scores show you what to check, and you can correct the merchant, date, category, currency and amounts before you export. Line items can't be edited yet.",
  },
  {
    q: "What are the limits on the free plan?",
    a: `Up to ${free.receiptsPerDay} receipts a day and ${free.workspaces} workspace. Need more? Contact us and we'll set you up.`,
  },
  {
    q: "Is it really free?",
    a: "Yes. The free plan needs no card and has no time limit. Paid plans with higher limits are coming.",
  },
  {
    q: "Who can see my receipts?",
    a: "Only you and the people you invite to your workspace. receiptOCR admins can access an account only to handle a support request. AI models from Google (Gemini) and Anthropic (Claude) read the images to extract the data. You can delete any receipt, or your whole account, from Settings.",
  },
  {
    q: "Can I get my data out?",
    a: "Any time. Download a CSV for one receipt or for everything in your workspace, or copy a receipt's data as JSON. No export fees.",
  },
];

/** Demo receipt used across the previews. Numbers add up: 79.77 + 7.08 tax = 86.85. */
export const demoReceipt = {
  merchant: "Paper & Co. Office Supply",
  shortMerchant: "PAPER & CO.",
  date: "Oct 28, 2026",
  isoDate: "2026-10-28",
  time: "14:06",
  category: "Office",
  currency: "USD",
  confidence: 96,
  items: [
    { name: "A5 notebook", qty: "2", price: "$12.00", confidence: 98 },
    { name: "Gel pens, 12 pack", qty: "1", price: "$8.49", confidence: 97 },
    { name: "USB-C cable 2m", qty: "1", price: "$14.99", confidence: 61 },
    { name: "Printer paper", qty: "1", price: "$9.79", confidence: 95 },
    { name: "Desk lamp", qty: "1", price: "$34.50", confidence: 99 },
  ],
  subtotal: "$79.77",
  tax: "$7.08",
  total: "$86.85",
};

/**
 * Illustrative rows for the CSV export preview, never real data: caption it as a preview wherever
 * it renders. Columns use the real headers from lib/csv.ts receiptsToCsv, with plain numbers.
 */
export const demoExport: Array<{
  date: string;
  merchant: string;
  category: string;
  tax: string;
  total: string;
}> = [
  {
    date: "2026-10-28",
    merchant: "Paper & Co.",
    category: "Office",
    tax: "7.08",
    total: "86.85",
  },
  {
    date: "2026-10-26",
    merchant: "Bluebird Café",
    category: "Meals",
    tax: "2.31",
    total: "28.41",
  },
  {
    date: "2026-10-24",
    merchant: "Metro Transit",
    category: "Travel",
    tax: "0.00",
    total: "45.00",
  },
  { date: "2026-10-21", merchant: "Shell", category: "Fuel", tax: "4.12", total: "61.30" },
  { date: "2026-10-19", merchant: "Fiber Net", category: "Utilities", tax: "6.40", total: "79.99" },
];
