const LOCAL_URL = "http://localhost:3000";

type SiteEnv = Partial<Record<string, string | undefined>>;

// VERCEL_PROJECT_PRODUCTION_URL (host only) exists only in Vercel-hosted builds. A `vercel build`
// run from CI does not get it, so set NEXT_PUBLIC_SITE_URL for any deployed build.
export function resolveSiteUrl(env: SiteEnv): { url: string; isFallback: boolean } {
  if (env.NEXT_PUBLIC_SITE_URL) return { url: env.NEXT_PUBLIC_SITE_URL, isFallback: false };
  if (env.VERCEL_PROJECT_PRODUCTION_URL) {
    return { url: `https://${env.VERCEL_PROJECT_PRODUCTION_URL}`, isFallback: false };
  }
  return { url: LOCAL_URL, isFallback: true };
}

const resolved = resolveSiteUrl(process.env);

// True when a production build on Vercel has no real public URL; canonical/sitemap URLs would be wrong.
export const siteUrlMissing =
  resolved.isFallback && process.env.NODE_ENV === "production" && process.env.VERCEL === "1";

if (
  resolved.isFallback &&
  process.env.NODE_ENV === "production" &&
  process.env.NEXT_PHASE === "phase-production-build"
) {
  console.warn(
    "[site] NEXT_PUBLIC_SITE_URL is not set; falling back to http://localhost:3000. Canonical links and the robots.txt Sitemap line are omitted on Vercel builds.",
  );
}

export const siteUrl = resolved.url;

// Undefined when the site URL is unknown, so pages emit no canonical rather than a localhost one.
export function canonicalFor(path: string): { canonical: string } | undefined {
  return siteUrlMissing ? undefined : { canonical: path };
}

export const siteTitle = "Receipt OCR: Turn Receipt Photos into CSV | receiptOCR";

export const siteDescription = `Receipt OCR that turns receipt photos and PDFs into spreadsheet rows. Extracts merchant, date, line items, tax and total with confidence scores. Free to start, no card required.`;

export const authorName = "Bhimraj Yadav";
export const authorUrl = "https://bhimraj.com.np";
// The CLI behind the same idea; it will later work with this site.
export const repoUrl = "https://github.com/bhimrazy/receipt-ocr";
