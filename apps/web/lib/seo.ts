import type { Metadata } from "next";
import { canonicalFor, siteUrl, siteUrlMissing } from "@/lib/site";

const SITE_NAME = "receiptOCR";

export const homeDescription =
  "Receipt OCR that turns receipt photos and PDFs into spreadsheet rows: merchant, date, line items, tax and total, with confidence scores. Free to start.";

// The root opengraph-image. A page's own `openGraph` drops the inherited file image, so it is
// named here; a segment with its own opengraph-image file still overrides this.
const DEFAULT_IMAGE = {
  url: "/opengraph-image",
  width: 1200,
  height: 630,
  alt: "receiptOCR: Turn receipt photos into spreadsheet rows",
};

/**
 * Title, description, canonical and social tags for one public page. A child segment's
 * `openGraph`/`twitter` replace the root layout's whole object, so every page sets its own;
 * otherwise each page would share the home page's og:title, og:url and description.
 */
export function pageMetadata({
  title,
  description,
  path,
  absoluteTitle = false,
  index = true,
}: {
  title: string;
  description: string;
  path: string;
  /** True when `title` is already the full title (skips the "· receiptOCR" template). */
  absoluteTitle?: boolean;
  /** False for pages that must stay out of search results (auth flows). */
  index?: boolean;
}): Metadata {
  const fullTitle = absoluteTitle ? title : `${title} · ${SITE_NAME}`;
  return {
    title: absoluteTitle ? { absolute: title } : title,
    description,
    ...(index ? { alternates: canonicalFor(path) } : { robots: { index: false, follow: true } }),
    openGraph: {
      type: "website",
      siteName: SITE_NAME,
      url: path,
      title: fullTitle,
      description,
      images: [DEFAULT_IMAGE],
    },
    twitter: {
      card: "summary_large_image",
      title: fullTitle,
      description,
      images: [DEFAULT_IMAGE],
    },
  };
}

/** Dates shown on the legal pages, also used as the sitemap's lastModified. */
export const LEGAL_UPDATED = {
  privacy: "2026-11-07",
  terms: "2026-11-07",
} as const;

export function formatLegalDate(isoDate: string): string {
  return new Date(`${isoDate}T00:00:00Z`).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

/**
 * Organization, WebSite and SoftwareApplication for the home page. Only claims the product backs
 * today: a free web app. No ratings, reviews or prices beyond the free plan.
 */
export function homeJsonLd(): Record<string, unknown> | null {
  if (siteUrlMissing) return null;
  const url = new URL("/", siteUrl).toString();
  const orgId = `${url}#organization`;
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": orgId,
        name: SITE_NAME,
        url,
        logo: new URL("/icon.svg", siteUrl).toString(),
      },
      {
        "@type": "WebSite",
        "@id": `${url}#website`,
        name: SITE_NAME,
        url,
        publisher: { "@id": orgId },
      },
      {
        "@type": "SoftwareApplication",
        name: SITE_NAME,
        url,
        description: homeDescription,
        applicationCategory: "BusinessApplication",
        operatingSystem: "Web",
        offers: { "@type": "Offer", price: "0", priceCurrency: "USD", description: "Free plan" },
        publisher: { "@id": orgId },
      },
    ],
  };
}

/** JSON for a `<script type="application/ld+json">`, with `<` escaped so text can't close the tag. */
export function jsonLdScript(data: unknown): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}
