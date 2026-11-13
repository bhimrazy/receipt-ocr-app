import type { ReceiptExtraction } from "@receipt-ocr/ai";

/** Every collection id; add one here with its collection in `lib/content/index.ts`. */
export type ContentCollectionId = "use-cases";

/** Lucide icons a page may name; `components/content/content-icons.ts` maps them. */
export type ContentIconName =
  | "briefcase"
  | "building"
  | "calculator"
  | "calendar-range"
  | "camera"
  | "crown"
  | "file-spreadsheet"
  | "folder-plus"
  | "receipt"
  | "search-check"
  | "tags"
  | "user"
  | "user-cog"
  | "users";

/** The decorative illustration beside a hero (`components/content/content-art.tsx`). */
export type HeroArtName = "pipeline" | "trip" | "client" | "tax-year" | "team";

/** A group of content pages under one path, such as `/use-cases`. */
export type ContentCollection = {
  id: ContentCollectionId;
  /** Hub page path, no trailing slash; each page lives at `${path}/${slug}`. */
  path: string;
  /** Breadcrumb and footer column name. */
  label: string;
  /** Hub page title without the "· ReceiptOCR" suffix. */
  title: string;
  description: string;
  h1: string;
  intro: string;
  heroArt: HeroArtName;
  /** YYYY-MM-DD the hub's visible content last changed (same rule as `ContentPage.updated`). */
  updated: string;
};

/**
 * One block of the page body. `paragraphs` always render first; `layout` picks what follows:
 * numbered step cards, icon tiles, a does / doesn't list, or the receipt-to-CSV field map.
 */
export type ContentSection = {
  heading: string;
  layout?: "prose" | "steps" | "tiles" | "does-doesnt" | "fieldmap";
  paragraphs?: string[];
  bullets?: string[];
  /** For `steps`: each body at most 25 words. */
  steps?: Array<{ icon: ContentIconName; title: string; body: string }>;
  /** For `tiles`: a one-line body, an optional chip and an optional three-node diagram. */
  tiles?: Array<{
    icon: ContentIconName;
    title: string;
    body: string;
    chip?: string;
    diagram?: [string, string, string];
  }>;
  /** For `does-doesnt`: 3 to 5 each. */
  does?: string[];
  doesnt?: string[];
  /** For `fieldmap`: receipt lines on the left, CSV columns on the right. */
  fieldmap?: {
    /** Printed lines, top to bottom; `amount` is right-aligned. */
    lines: Array<{ text: string; amount?: string }>;
    /** CSV columns in export order; `from` is the index of the line it is read from. */
    fields: Array<{ name: string; value: string; from?: number; note?: string }>;
  };
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
  /** Other receipts in the Receipts CSV, after the example one. */
  historyRows?: Array<Omit<ReceiptExtraction, "items"> & { itemCount: number; fileName: string }>;
  /** Group names on every row of the Receipts CSV. */
  groups?: string[];
};

export type ContentFaq = { q: string; a: string };

export type ContentPage = {
  collection: ContentCollectionId;
  /** Lowercase kebab-case; the last URL segment. */
  slug: string;
  /** Title without the "· ReceiptOCR" suffix; the full title must fit 60 characters. */
  title: string;
  /** Meta description, 120 to 155 characters. */
  description: string;
  h1: string;
  /** Short name for the footer, cards and related links. */
  navLabel: string;
  /** Icon on the hub and related cards. */
  icon: ContentIconName;
  heroArt: HeroArtName;
  /** The page's own fact tile, shown after the shared ones under the hero. */
  fact: string;
  /** Lead paragraph under the h1. */
  intro: string;
  /**
   * YYYY-MM-DD the page's visible content last changed; the sitemap's lastModified and the
   * WebPage's dateModified. Set per page and bumped only when that page changes, never shared.
   */
  updated: string;
  sections: ContentSection[];
  example?: ContentExample;
  /** How many sections come before the example; default 1. */
  exampleAfter?: number;
  /** 3 to 5; rendered on the page and as FAQPage JSON-LD, so the two always match. */
  faqs: ContentFaq[];
  /** Paths of other content pages to link at the end. */
  related: string[];
  cta: { heading: string; body: string };
};
