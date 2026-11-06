import type { MetadataRoute } from "next";
import { siteUrl, siteUrlMissing } from "@/lib/site";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [
        "/app",
        "/admin",
        "/api",
        "/accept-invitation",
        "/reset-password",
        "/forgot-password",
        "/landing-",
        "/final-",
      ],
    },
    ...(siteUrlMissing ? {} : { sitemap: `${siteUrl}/sitemap.xml` }),
  };
}
