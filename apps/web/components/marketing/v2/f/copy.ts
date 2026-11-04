import { freePlan } from "../../content";

/* Direction F copy. Facts come from content.ts; only the voice lives here. */

export const nav = [
  { href: "#how", label: "How it works" },
  { href: "#trust", label: "Your data" },
  { href: "#pricing", label: "Pricing" },
  { href: "#faq", label: "FAQ" },
];

export const hero = {
  eyebrow: "For small shops and side hustles",
  lead: `Take a photo of any receipt. receiptOCR reads the shop, the date, every item, the tax and the total, then hands you a spreadsheet. Free for ${freePlan.receiptsPerDay} receipts a day.`,
  reassurance: ["No card", "No app to install", `${freePlan.receiptsPerDay} receipts a day free`],
};

export const ticker = [
  "Merchant",
  "Date",
  "Every line item",
  "Tax",
  "Tip",
  "Total",
  "Category",
  "PNG · JPG · HEIC",
  "Up to 20 at once",
  "CSV export",
];

export const queue = [
  { file: "IMG_2041.HEIC", status: "Read", done: true },
  { file: "IMG_2042.JPG", status: "Reading", done: false },
  { file: "scan-0419.png", status: "Queued", done: false },
];

export const facts = [
  { big: "20", unit: "photos", note: "per upload, read one after another" },
  { big: "10", unit: "MB", note: "per photo, so phone shots are fine" },
  { big: "PNG JPG HEIC", unit: "", note: "photos and scans. PDF is coming." },
  {
    big: "Every line",
    unit: "",
    note: "merchant, date, items, subtotal, tax, tip, total, currency and category",
  },
  { big: "CSV", unit: "+ JSON", note: "for one receipt or the whole workspace, any time" },
];

export const trustSteps = [
  { title: "Your phone or computer", body: "You take the photo or pick the file." },
  { title: "Private storage", body: "The image is stored for your workspace only." },
  { title: "Google Gemini", body: "Google's AI reads the image and sends back the fields." },
  { title: "Your workspace", body: "You and the people you invite. Nobody else." },
];
