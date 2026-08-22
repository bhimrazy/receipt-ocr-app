/**
 * Closed set of receipt categories.
 *
 * Deliberately a dependency-free leaf module with its own package export
 * (`@receipt-ocr/ai/categories`): client components need this list to build
 * filters and pickers, and importing it from the package root would drag the
 * AI SDK — and transitively the database driver, via core — into the browser
 * bundle.
 */
export const RECEIPT_CATEGORIES = [
  "Grocery",
  "Restaurant",
  "Gas",
  "Pharmacy",
  "Shopping",
  "Travel",
  "Utilities",
  "Entertainment",
  "Services",
  "Other",
] as const;

export type ReceiptCategory = (typeof RECEIPT_CATEGORIES)[number];
