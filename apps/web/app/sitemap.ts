import type { MetadataRoute } from "next";
import { siteUrl, siteUrlMissing } from "@/lib/site";

export default function sitemap(): MetadataRoute.Sitemap {
  if (siteUrlMissing) return [];
  return ["/", "/privacy", "/terms", "/cookies"].map((path) => ({ url: new URL(path, siteUrl).toString() }));
}
