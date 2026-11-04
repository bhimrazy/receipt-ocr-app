import { PLANS } from "@/lib/plans";

// Vercel sets VERCEL_PROJECT_PRODUCTION_URL (host only) on every deployment. Falling back instead of
// throwing keeps builds without NEXT_PUBLIC_SITE_URL working.
const productionHost = process.env.VERCEL_PROJECT_PRODUCTION_URL;

export const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL ||
  (productionHost ? `https://${productionHost}` : "http://localhost:3000");

export const siteTitle = "Receipt OCR: Turn Receipt Photos into CSV | receiptOCR";

export const siteDescription = `Receipt OCR that turns photos of receipts (PNG, JPG, HEIC) into spreadsheet rows. Extracts merchant, date, line items, tax and total with confidence scores. Free, ${PLANS.free.receiptsPerDay} receipts a day.`;
