import type { MetadataRoute } from "next";
import { siteUrl, siteUrlMissing } from "@/lib/site";

// Signed-in pages, admin and auth flows stay crawlable so crawlers can read their noindex
// (meta tag and X-Robots-Tag in next.config.ts); a Disallow would hide it and let a linked URL
// be indexed without content. Only the API and the lab pages (404 in production) are blocked.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/api/", "/landing-", "/final-"],
    },
    ...(siteUrlMissing ? {} : { sitemap: `${siteUrl}/sitemap.xml` }),
  };
}
