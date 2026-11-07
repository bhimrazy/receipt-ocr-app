import { demoReceipt, freePlan } from "../../content";

/* Copy for direction H. Facts come from ../../content, which notes where each is enforced. */

export const navLinks = [
  { href: "#how", label: "How it works" },
  { href: "#data", label: "Your data" },
  { href: "#pricing", label: "Pricing" },
  { href: "#faq", label: "FAQ" },
];

export const reassurance = `$0 · ${freePlan.receiptsPerDay} receipts a day · No card required`;

export const steps = [
  {
    index: "01",
    title: "Drop in a stack of photos.",
    body: "Phone snaps or desk scans, up to 20 at a time. PNG, JPG or HEIC up to 10 MB each. They're queued and scanned one after another.",
    note: "PDF receipts are coming.",
  },
  {
    index: "02",
    title: "Check only what's flagged.",
    body: "Every receipt and every line item gets a confidence score. Low scores are flagged, so you know which line to compare with the paper instead of rereading all of it.",
    note: "Fix the merchant, date, category or totals in place.",
  },
  {
    index: "03",
    title: "Hand your books a CSV.",
    body: "Download one receipt or your whole workspace as CSV, ready for a spreadsheet or your accountant. Copy any receipt as JSON if you build things.",
    note: "No export fees.",
  },
];

export const dataStops = [
  {
    name: "Your phone or computer",
    body: "You take a photo or pick a file.",
  },
  {
    name: "Private storage",
    body: "The image is stored for your workspace only.",
  },
  {
    name: "Google Gemini",
    body: "Google's AI scans the image and returns the fields.",
  },
  {
    name: "Your workspace",
    body: "You and the people you invite review, edit and export. Delete a receipt, or your account, from Settings.",
  },
];

export const uploadQueue: Array<{
  name: string;
  size: string;
  status: "read" | "reading" | "queued";
}> = [
  { name: "IMG_4021.HEIC", size: "2.4 MB", status: "read" },
  { name: "IMG_4022.HEIC", size: "2.1 MB", status: "read" },
  { name: "scan-bluebird.png", size: "840 KB", status: "reading" },
  { name: "shell-oct21.jpg", size: "1.2 MB", status: "queued" },
];

/** The line the hero and step 02 both flag; it keeps the two figures telling one story. */
export const flaggedItem = demoReceipt.items.find((item) => item.confidence < 80);
