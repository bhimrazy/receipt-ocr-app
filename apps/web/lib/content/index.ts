import type { Metadata, MetadataRoute } from "next";
import { fullTitle, pageMetadata, siteNodeIds } from "@/lib/seo";
import { SITE_NAME, siteUrl } from "@/lib/site";
import type { ContentCollection, ContentCollectionId, ContentPage } from "./types";
import { useCasePages, useCasesCollection } from "./use-cases";

/**
 * Every content collection and page. A new collection (guides, comparisons) adds its collection
 * and pages here; the sitemap, llms.txt and footer pick them up from these lists.
 */
export const contentCollections: ContentCollection[] = [useCasesCollection];
export const contentPages: ContentPage[] = [...useCasePages];

const abs = (path: string) => new URL(path, siteUrl).toString();

export function collectionById(id: ContentCollectionId): ContentCollection {
  const collection = contentCollections.find((c) => c.id === id);
  if (!collection) throw new Error(`Unknown content collection: ${id}`);
  return collection;
}

export function pagesIn(id: ContentCollectionId): ContentPage[] {
  return contentPages.filter((page) => page.collection === id);
}

export function contentPath(page: ContentPage): string {
  return `${collectionById(page.collection).path}/${page.slug}`;
}

/** The page served at `path`, if any; routes and related links look pages up by path. */
export function contentPageAt(path: string): ContentPage | undefined {
  return contentPages.find((page) => contentPath(page) === path);
}

export function contentMetadata(page: ContentPage): Metadata {
  return pageMetadata({
    title: page.title,
    description: page.description,
    path: contentPath(page),
  });
}

export function collectionMetadata(collection: ContentCollection): Metadata {
  return pageMetadata({
    title: collection.title,
    description: collection.description,
    path: collection.path,
  });
}

function breadcrumb(id: string, trail: Array<{ name: string; path: string }>) {
  return {
    "@type": "BreadcrumbList",
    "@id": id,
    itemListElement: trail.map((crumb, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: crumb.name,
      item: abs(crumb.path),
    })),
  };
}

/**
 * Short WebSite and WebApplication nodes with the home page's `@id`s, so `isPartOf` and `about`
 * resolve within this page's graph. The full nodes are on the home page.
 */
function siteStubs() {
  const ids = siteNodeIds();
  const url = abs("/");
  return [
    { "@type": "WebSite", "@id": ids.website, name: SITE_NAME, url },
    { "@type": "WebApplication", "@id": ids.app, name: SITE_NAME, url },
  ];
}

/** Breadcrumbs shown on the page and in its BreadcrumbList, Home first. */
export function contentBreadcrumbs(page: ContentPage) {
  const collection = collectionById(page.collection);
  return [
    { name: "Home", path: "/" },
    { name: collection.label, path: collection.path },
    { name: page.navLabel, path: contentPath(page) },
  ];
}

/**
 * BreadcrumbList, WebPage (about the app, part of the site) and FAQPage, plus the site stubs.
 * The FAQ entity is built from `page.faqs`, which the page also renders, so the two cannot drift.
 */
export function contentJsonLd(page: ContentPage): Record<string, unknown> {
  const url = abs(contentPath(page));
  const ids = siteNodeIds();
  return {
    "@context": "https://schema.org",
    "@graph": [
      breadcrumb(`${url}#breadcrumb`, contentBreadcrumbs(page)),
      {
        "@type": "WebPage",
        "@id": `${url}#webpage`,
        url,
        name: fullTitle(page.title),
        headline: page.h1,
        description: page.description,
        inLanguage: "en",
        dateModified: page.updated,
        isPartOf: { "@id": ids.website },
        about: { "@id": ids.app },
        breadcrumb: { "@id": `${url}#breadcrumb` },
      },
      {
        "@type": "FAQPage",
        "@id": `${url}#faq`,
        mainEntity: page.faqs.map((faq) => ({
          "@type": "Question",
          name: faq.q,
          acceptedAnswer: { "@type": "Answer", text: faq.a },
        })),
      },
      ...siteStubs(),
    ],
  };
}

/** BreadcrumbList and CollectionPage listing the collection's pages, plus the site stubs. */
export function collectionJsonLd(collection: ContentCollection): Record<string, unknown> {
  const url = abs(collection.path);
  const ids = siteNodeIds();
  return {
    "@context": "https://schema.org",
    "@graph": [
      breadcrumb(`${url}#breadcrumb`, [
        { name: "Home", path: "/" },
        { name: collection.label, path: collection.path },
      ]),
      {
        "@type": "CollectionPage",
        "@id": `${url}#webpage`,
        url,
        name: fullTitle(collection.title),
        description: collection.description,
        inLanguage: "en",
        dateModified: collection.updated,
        isPartOf: { "@id": ids.website },
        about: { "@id": ids.app },
        breadcrumb: { "@id": `${url}#breadcrumb` },
        mainEntity: {
          "@type": "ItemList",
          itemListElement: pagesIn(collection.id).map((page, index) => ({
            "@type": "ListItem",
            position: index + 1,
            url: abs(contentPath(page)),
            name: page.h1,
          })),
        },
      },
      ...siteStubs(),
    ],
  };
}

/** Each collection's hub, then its pages. */
export function contentSitemapEntries(): MetadataRoute.Sitemap {
  return contentCollections.flatMap((collection) => [
    { url: abs(collection.path), lastModified: collection.updated },
    ...pagesIn(collection.id).map((page) => ({
      url: abs(contentPath(page)),
      lastModified: page.updated,
    })),
  ]);
}

/** One llms.txt section per collection: a heading, the hub link, then each page. */
export function contentLlmsSections(): string[] {
  return contentCollections.flatMap((collection) => [
    `## ${collection.label}`,
    "",
    `- [${collection.title}](${abs(collection.path)}): ${collection.description}`,
    ...pagesIn(collection.id).map(
      (page) => `- [${page.title}](${abs(contentPath(page))}): ${page.description}`,
    ),
    "",
  ]);
}

/** Footer columns, one per collection. */
export function contentFooterColumns(): Array<{
  title: string;
  links: Array<{ label: string; href: string }>;
}> {
  return contentCollections.map((collection) => ({
    title: collection.label,
    links: pagesIn(collection.id).map((page) => ({
      label: page.navLabel,
      href: contentPath(page),
    })),
  }));
}
