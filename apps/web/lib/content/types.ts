import type { ReceiptExtraction } from "@receipt-ocr/ai";

/** A group of content pages under one path, such as `/use-cases`. */
export type ContentCollection = {
  id: string;
  /** Hub page path, no trailing slash; each page lives at `${path}/${slug}`. */
  path: string;
  /** Breadcrumb and footer column name. */
  label: string;
  /** Hub page title without the "· ReceiptOCR" suffix. */
  title: string;
  description: string;
  h1: string;
  intro: string;
  /** YYYY-MM-DD the hub's visible content last changed (same rule as `ContentPage.updated`). */
  updated: string;
};

export type ContentSection = {
  heading: string;
  paragraphs: string[];
  /** Rendered as a numbered list after the paragraphs. */
  steps?: Array<{ title: string; body: string }>;
  /** Rendered as a bulleted list after the paragraphs (and steps). */
  bullets?: string[];
};

/**
 * A sample receipt, shown the way the receipt page shows it. `extraction` has the shape the OCR
 * model returns, so the JSON view is what Copy JSON gives.
 */
export type ContentExample = {
  heading: string;
  caption: string;
  fileName: string;
  extraction: ReceiptExtraction;
  /** What the export panel shows: Copy JSON, or the History CSV with `historyRows` as extra rows. */
  exportView: "json" | "history-csv";
  /** Other receipts in the History CSV, after the example one. */
  historyRows?: Array<Omit<ReceiptExtraction, "items"> & { itemCount: number; fileName: string }>;
  /** Group names on every row of the History CSV. */
  groups?: string[];
};

export type ContentFaq = { q: string; a: string };

export type ContentPage = {
  collection: ContentCollection["id"];
  /** Lowercase kebab-case; the last URL segment. */
  slug: string;
  /** Title without the "· ReceiptOCR" suffix; the full title must fit 60 characters. */
  title: string;
  /** Meta description, 120 to 155 characters. */
  description: string;
  h1: string;
  /** Short name for the footer, cards and related links. */
  navLabel: string;
  /** Lead paragraph under the h1. */
  intro: string;
  /**
   * YYYY-MM-DD the page's visible content last changed; the sitemap's lastModified and the
   * WebPage's dateModified. Set per page and bumped only when that page changes, never shared.
   */
  updated: string;
  sections: ContentSection[];
  example?: ContentExample;
  /** 3 to 5; rendered on the page and as FAQPage JSON-LD, so the two always match. */
  faqs: ContentFaq[];
  /** Paths of other content pages to link at the end. */
  related: string[];
  cta: { heading: string; body: string };
};
