import type { Metadata } from "next";
import { SITE_NAME, siteUrl } from "@/lib/site";

/**
 * Home page title and description, also the site-wide defaults. "Receipt scanner" is the term
 * people search for (receipt OCR lives in the brand); the rest names what comes out. Google shows
 * about 60 title and 155 description characters, so each fact is pulled from the site's own copy.
 * Outputs are CSV and JSON only: nothing writes .xlsx, so Excel is never named.
 */
export const homeTitle = `Receipt Scanner: Extract Data to CSV & JSON · ${SITE_NAME}`;
export const homeDescription =
  "Free receipt scanner: turn photos and PDFs into structured data (merchant, date, line items, tax, total) with confidence scores. Export CSV or copy JSON.";

// The root opengraph-image. A page's own `openGraph` drops the inherited file image, so it is
// named here; a segment with its own opengraph-image file still overrides this.
/** Alt text for the root Open Graph image; must describe what `app/opengraph-image.tsx` draws. */
export const OG_IMAGE_ALT = `${SITE_NAME}: turn receipt photos into structured data, exported as CSV or JSON`;

const DEFAULT_IMAGE = {
  url: "/opengraph-image",
  width: 1200,
  height: 630,
  alt: OG_IMAGE_ALT,
};

/** A page's full `<title>`: the root layout's "%s · ReceiptOCR" template applied to `title`. */
export function fullTitle(title: string): string {
  return `${title} · ${SITE_NAME}`;
}

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
  const shownTitle = absoluteTitle ? title : fullTitle(title);
  return {
    title: absoluteTitle ? { absolute: title } : title,
    description,
    ...(index ? { alternates: { canonical: path } } : { robots: { index: false, follow: true } }),
    openGraph: {
      type: "website",
      siteName: SITE_NAME,
      url: path,
      title: shownTitle,
      description,
      images: [DEFAULT_IMAGE],
    },
    twitter: {
      card: "summary_large_image",
      title: shownTitle,
      description,
      images: [DEFAULT_IMAGE],
    },
  };
}

/** Dates shown on the legal pages, also used as the sitemap's lastModified. */
export const LEGAL_UPDATED = {
  privacy: "2026-11-08",
  terms: "2026-11-08",
  refunds: "2026-11-08",
  pricing: "2026-11-08",
  cookies: "2026-11-06",
} as const;

/** Home page copy last changed; the sitemap's lastModified for "/". */
export const HOME_UPDATED = "2026-11-08";

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

/** What the app does, in the words the site uses; the WebApplication node's featureList. */
const APP_FEATURES = [
  "Receipt photo and PDF upload (JPEG, PNG, WebP, HEIC, PDF)",
  "Merchant, date, line items, tax and total extracted",
  "Confidence score per receipt and per line item",
  "Totals that do not add up are flagged for review",
  "Searchable receipt history",
  "CSV export and JSON copy",
  "Shared workspaces",
] as const;

/** Other names for the site; Google's site-name result reads `alternateName` before falling back to the domain. */
const SITE_ALTERNATE_NAMES = ["Receipt OCR"] as const;

/** `@id`s of the home page's JSON-LD nodes, so other pages can point at them instead of repeating them. */
export function siteNodeIds() {
  const url = new URL("/", siteUrl).toString();
  return {
    person: `${OWNER.url}/#person`,
    organization: `${url}#organization`,
    website: `${url}#website`,
    app: `${url}#app`,
  };
}

/**
 * Organization (with its founder), WebSite and WebApplication for the home page. Only claims the
 * product backs today and the page shows: a free web app. No ratings, reviews or prices beyond
 * the free plan. Google's software rich result needs a rating or review, so none is expected;
 * the nodes describe the entity.
 */
export function homeJsonLd(): Record<string, unknown> {
  const url = new URL("/", siteUrl).toString();
  const { organization: orgId, person: personId, website, app } = siteNodeIds();
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
        alternateName: [...SITE_ALTERNATE_NAMES],
        url,
        logo: new URL("/icons/icon-512.png", siteUrl).toString(),
        founder: { "@id": personId },
        sameAs: [REPO_URL],
      },
      {
        "@type": "WebSite",
        "@id": website,
        name: SITE_NAME,
        alternateName: [...SITE_ALTERNATE_NAMES],
        url,
        description: homeDescription,
        inLanguage: "en",
        publisher: { "@id": orgId },
      },
      {
        "@type": "WebApplication",
        "@id": app,
        name: SITE_NAME,
        url,
        description: homeDescription,
        applicationCategory: "BusinessApplication",
        operatingSystem: "Web",
        browserRequirements: "Requires JavaScript",
        featureList: [...APP_FEATURES],
        isAccessibleForFree: true,
        offers: {
          "@type": "Offer",
          name: "Free plan",
          price: "0",
          priceCurrency: "USD",
          availability: "https://schema.org/InStock",
          url: new URL("/sign-up", siteUrl).toString(),
        },
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
