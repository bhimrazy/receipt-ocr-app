import type { MetadataRoute } from "next";
import { headers } from "next/headers";
import { PRODUCTION_DISALLOW, isProductionHost, requestHost } from "@/lib/seo-hosts";
import { siteUrl } from "@/lib/site";

export function robotsFor(host: string): MetadataRoute.Robots {
  if (!isProductionHost(host)) return { rules: { userAgent: "*", disallow: "/" } };
  return {
    rules: { userAgent: "*", allow: "/", disallow: PRODUCTION_DISALLOW },
    sitemap: `${siteUrl}/sitemap.xml`,
  };
}

// Decided per request by host. Every non-production host (previews, localhost) blocks everything;
// X-Robots-Tag (next.config.ts) covers responses a crawler fetches regardless.
export default async function robots(): Promise<MetadataRoute.Robots> {
  return robotsFor(requestHost(await headers()));
}
