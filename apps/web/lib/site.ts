import { PRODUCTION_ORIGIN } from "@/lib/seo-hosts";

// Canonicals, the sitemap and social cards always name the production host, whichever host serves
// the page: non-production hosts are noindex, and their canonical then points at the real page.
export const siteUrl = PRODUCTION_ORIGIN;

export const siteTitle = "Receipt OCR: Turn Receipt Photos into CSV | receiptOCR";

export const siteDescription = `Receipt OCR that turns receipt photos and PDFs into spreadsheet rows. Extracts merchant, date, line items, tax and total with confidence scores. Free to start, no card required.`;

export const authorName = "Bhimraj Yadav";
export const authorUrl = "https://bhimraj.com.np";
// The CLI behind the same idea; it will later work with this site.
export const repoUrl = "https://github.com/bhimrazy/receipt-ocr";
