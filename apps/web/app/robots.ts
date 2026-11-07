import type { MetadataRoute } from "next";
import { siteUrl, siteUrlMissing } from "@/lib/site";

// Signed-in pages, admin and auth flows stay crawlable so crawlers can read their noindex
// (meta tag and X-Robots-Tag in next.config.ts); a Disallow would hide it and let a linked URL
// be indexed without content. Only the API and the lab pages (404 in production) are blocked.
// Non-production Vercel deployments block everything: they sit behind Deployment Protection and carry
// X-Robots-Tag: noindex, so there is no content for a crawler to reach anyway.
export default function robots(): MetadataRoute.Robots {
  if (process.env.VERCEL_ENV !== undefined && process.env.VERCEL_ENV !== "production") {
    return { rules: { userAgent: "*", disallow: "/" } };
  }
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/api/", "/landing-", "/final-"],
    },
    ...(siteUrlMissing ? {} : { sitemap: `${siteUrl}/sitemap.xml` }),
  };
}
