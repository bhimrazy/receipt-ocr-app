import { demoReceipt, freePlan } from "../../content";

/*
 * Demo data for direction G. Categories come from RECEIPT_CATEGORIES (packages/ai), confidence
 * tiers from lib/format.ts (>= 90 High, >= 75 Check, else Review) and statuses from
 * components/receipt-status.tsx, so the drawn product matches what the app shows.
 */

export type Tier = "high" | "check" | "review";

export function tier(score: number): Tier {
  if (score >= 90) return "high";
  if (score >= 75) return "check";
  return "review";
}

export const receipt = { ...demoReceipt, category: "Office", tip: null as string | null };

export type HistoryRow =
  | {
      status: "done";
      merchant: string;
      date: string;
      category: string;
      confidence: number;
      total: string;
    }
  | { status: "reading" | "failed"; file: string; uploaded: string };

export const history: HistoryRow[] = [
  { status: "reading", file: "IMG_2044.jpg", uploaded: "Just now" },
  {
    status: "done",
    merchant: receipt.merchant,
    date: "Oct 28, 2026",
    category: "Office",
    confidence: 96,
    total: "$86.85",
  },
  {
    status: "done",
    merchant: "Bluebird Café",
    date: "Oct 26, 2026",
    category: "Meals",
    confidence: 84,
    total: "$28.41",
  },
  {
    status: "done",
    merchant: "Metro Transit",
    date: "Oct 24, 2026",
    category: "Travel",
    confidence: 99,
    total: "$45.00",
  },
  { status: "failed", file: "IMG_2041.heic", uploaded: "Oct 22, 2026" },
  {
    status: "done",
    merchant: "Shell",
    date: "Oct 21, 2026",
    category: "Fuel",
    confidence: 93,
    total: "$61.30",
  },
];

/** CSV preview; column names are a subset of lib/csv.ts receiptsToCsv, in its order. */
export const csvHeader = ["merchant", "receipt_date", "category", "currency", "tax", "total"];
export const csvRows = [
  ["Paper & Co. Office Supply", "2026-10-28", "Office", "USD", "7.08", "86.85"],
  ["Bluebird Café", "2026-10-26", "Meals", "USD", "2.31", "28.41"],
  ["Metro Transit", "2026-10-24", "Travel", "USD", "0.00", "45.00"],
  ["Shell", "2026-10-21", "Fuel", "USD", "4.12", "61.30"],
];

export const plan = freePlan;
