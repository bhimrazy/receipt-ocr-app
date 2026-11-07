import type { MetadataRoute } from "next";
import { LEGAL_UPDATED } from "@/lib/seo";
import { siteUrl, siteUrlMissing } from "@/lib/site";

/** Every indexable page; e2e/seo.spec.ts checks each is served, canonical and not noindex. */
export default function sitemap(): MetadataRoute.Sitemap {
  if (siteUrlMissing) return [];
  const url = (path: string) => new URL(path, siteUrl).toString();
  return [
    { url: url("/") },
    { url: url("/privacy"), lastModified: LEGAL_UPDATED.privacy },
    { url: url("/terms"), lastModified: LEGAL_UPDATED.terms },
    { url: url("/cookies") },
  ];
}
