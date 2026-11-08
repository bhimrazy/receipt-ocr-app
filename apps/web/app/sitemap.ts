import type { MetadataRoute } from "next";
import { contentSitemapEntries } from "@/lib/content";
import { HOME_UPDATED, LEGAL_UPDATED } from "@/lib/seo";
import { siteUrl } from "@/lib/site";

/** Every indexable page; e2e/seo.spec.ts checks each is served, canonical and not noindex. */
export default function sitemap(): MetadataRoute.Sitemap {
  const url = (path: string) => new URL(path, siteUrl).toString();
  return [
    { url: url("/"), lastModified: HOME_UPDATED },
    { url: url("/pricing"), lastModified: LEGAL_UPDATED.pricing },
    { url: url("/privacy"), lastModified: LEGAL_UPDATED.privacy },
    { url: url("/terms"), lastModified: LEGAL_UPDATED.terms },
    { url: url("/cookies"), lastModified: LEGAL_UPDATED.cookies },
    { url: url("/refunds"), lastModified: LEGAL_UPDATED.refunds },
    ...contentSitemapEntries(),
  ];
}
