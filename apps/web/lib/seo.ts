import type { Metadata } from "next";
import { SITE_NAME, siteUrl } from "@/lib/site";

export const homeDescription =
  "Receipt OCR that turns receipt photos and PDFs into spreadsheet rows: merchant, date, line items, tax and total, with confidence scores. Free to start.";

// The root opengraph-image. A page's own `openGraph` drops the inherited file image, so it is
// named here; a segment with its own opengraph-image file still overrides this.
const DEFAULT_IMAGE = {
  url: "/opengraph-image",
  width: 1200,
  height: 630,
  alt: `${SITE_NAME}: Turn receipt photos into spreadsheet rows`,
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
  /** True when `title` is already the full title (skips the "· ReceiptOCR" template). */
  absoluteTitle?: boolean;
  /** False for pages that must stay out of search results (auth flows). */
  index?: boolean;
}): Metadata {
  const fullTitle = absoluteTitle ? title : `${title} · ${SITE_NAME}`;
  return {
    title: absoluteTitle ? { absolute: title } : title,
    description,
    ...(index ? { alternates: { canonical: path } } : { robots: { index: false, follow: true } }),
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
  cookies: "2026-11-06",
} as const;

/** Home page copy last changed; the sitemap's lastModified for "/". */
export const HOME_UPDATED = "2026-11-07";

export const OWNER = {
  name: "Bhimraj Yadav",
  url: "https://bhimraj.com.np",
  github: "https://github.com/bhimrazy",
} as const;
export const REPO_URL = "https://github.com/bhimrazy/receipt-ocr";

export function formatLegalDate(isoDate: string): string {
  return new Date(`${isoDate}T00:00:00Z`).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

/**
 * Organization (with its founder), WebSite and SoftwareApplication for the home page. Only claims
 * the product backs today: a free web app, installable as a PWA. No ratings, reviews or prices
 * beyond the free plan; the custom plan has no public price, so it has no Offer.
 */
export function homeJsonLd(): Record<string, unknown> {
  const url = new URL("/", siteUrl).toString();
  const orgId = `${url}#organization`;
  const personId = `${OWNER.url}/#person`;
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Person",
        "@id": personId,
        name: OWNER.name,
        url: OWNER.url,
        sameAs: [OWNER.github],
      },
      {
        "@type": "Organization",
        "@id": orgId,
        name: SITE_NAME,
        url,
        logo: new URL("/icons/icon-512.png", siteUrl).toString(),
        founder: { "@id": personId },
        sameAs: [REPO_URL],
      },
      {
        "@type": "WebSite",
        "@id": `${url}#website`,
        name: SITE_NAME,
        url,
        inLanguage: "en",
        publisher: { "@id": orgId },
      },
      {
        "@type": "SoftwareApplication",
        "@id": `${url}#app`,
        name: SITE_NAME,
        url,
        description: homeDescription,
        applicationCategory: "FinanceApplication",
        operatingSystem: "Web",
        isAccessibleForFree: true,
        offers: { "@type": "Offer", price: "0", priceCurrency: "USD", description: "Free plan" },
        publisher: { "@id": orgId },
        author: { "@id": personId },
      },
    ],
  };
}

/** JSON for a `<script type="application/ld+json">`, with `<` escaped so text can't close the tag. */
export function jsonLdScript(data: unknown): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}
