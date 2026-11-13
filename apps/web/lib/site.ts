import { PRODUCTION_ORIGIN } from "@/lib/seo-hosts";

// Canonicals, the sitemap and social cards always name the production host, whichever host serves
// the page: non-production hosts are noindex, and their canonical then points at the real page.
export const siteUrl = PRODUCTION_ORIGIN;

// The one spelling of the product name wherever users see it (the wordmark styling is separate).
export const SITE_NAME = "ReceiptOCR";

export const authorName = "Bhimraj Yadav";
export const authorUrl = "https://bhimraj.com.np";
// Published for viewing only (see LICENSE), so it is "source", never "open source".
export const repoUrl = "https://github.com/bhimrazy/receipt-ocr-app";
