import { describe, expect, it } from "vitest";
import sitemap from "@/app/sitemap";
import { exampleCsv } from "@/lib/content/example-csv";
import {
  collectionJsonLd,
  contentCollections,
  contentFooterColumns,
  contentJsonLd,
  contentPageAt,
  contentPages,
  contentPath,
  pagesIn,
} from "@/lib/content";
import type { ContentPage } from "@/lib/content/types";
import { llmsFullTxt, llmsTxt } from "@/lib/llms";
import { fullTitle, homeTitle, siteNodeIds } from "@/lib/seo";
import { PRODUCTION_ORIGIN } from "@/lib/seo-hosts";

const abs = (path: string) => new URL(path, PRODUCTION_ORIGIN).toString();

/** Every word a visitor reads in the page body, whatever layout carries it. */
function prose(page: ContentPage): string {
  return [
    page.h1,
    page.intro,
    page.fact,
    ...page.sections.flatMap((s) => [
      s.heading,
      ...(s.paragraphs ?? []),
      ...(s.bullets ?? []),
      ...(s.steps ?? []).flatMap((step) => [step.title, step.body]),
      ...(s.tiles ?? []).flatMap((tile) => [tile.title, tile.body, tile.chip ?? ""]),
      ...(s.does ?? []),
      ...(s.doesnt ?? []),
    ]),
    page.example?.heading ?? "",
    page.example?.caption ?? "",
    ...page.faqs.flatMap((f) => [f.q, f.a]),
    page.cta.heading,
    page.cta.body,
  ].join(" ");
}

const words = (text: string) => text.toLowerCase().match(/[a-z']+/g) ?? [];

const titled = [
  ...contentCollections.map((c) => ({ path: c.path, title: c.title, description: c.description })),
  ...contentPages.map((p) => ({
    path: contentPath(p),
    title: p.title,
    description: p.description,
  })),
];

describe("content metadata", () => {
  it.each(titled)("$path: title fits 60 and description 120 to 155 characters", (entry) => {
    expect(fullTitle(entry.title).length).toBeLessThanOrEqual(60);
    expect(entry.description.length).toBeGreaterThanOrEqual(120);
    expect(entry.description.length).toBeLessThanOrEqual(155);
  });

  it("titles, descriptions, h1s and paths are unique across the site", () => {
    const titles = [homeTitle, ...titled.map((e) => fullTitle(e.title))];
    expect(new Set(titles).size).toBe(titles.length);
    const descriptions = titled.map((e) => e.description);
    expect(new Set(descriptions).size).toBe(descriptions.length);
    const h1s = [...contentCollections.map((c) => c.h1), ...contentPages.map((p) => p.h1)];
    expect(new Set(h1s).size).toBe(h1s.length);
    const paths = titled.map((e) => e.path);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it.each(contentPages.map((p) => [contentPath(p), p] as const))(
    "%s: kebab-case slug in a known collection",
    (_path, page) => {
      expect(page.slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(contentCollections.map((c) => c.id)).toContain(page.collection);
    },
  );

  it.each([...contentCollections, ...contentPages].map((e) => [e.title, e.updated] as const))(
    "%s: updated is a real YYYY-MM-DD date, not in the future",
    (_title, updated) => {
      expect(updated).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      const date = new Date(`${updated}T00:00:00Z`);
      expect(date.toISOString().slice(0, 10)).toBe(updated);
      expect(date.getTime()).toBeLessThanOrEqual(Date.now());
    },
  );
});

describe("content pages", () => {
  it("the four use cases exist", () => {
    expect(pagesIn("use-cases").map(contentPath)).toEqual([
      "/use-cases/expense-reports",
      "/use-cases/bookkeeping",
      "/use-cases/freelancers-taxes",
      "/use-cases/small-businesses",
    ]);
  });

  it.each(contentPages.map((p) => [contentPath(p), p] as const))(
    "%s: has substance, 3 to 5 FAQs, an example and working related links",
    (path, page) => {
      const count = words(prose(page)).length;
      expect(count, `${path} words`).toBeGreaterThanOrEqual(500);
      expect(count, `${path} words`).toBeLessThanOrEqual(900);
      expect(page.faqs.length).toBeGreaterThanOrEqual(3);
      expect(page.faqs.length).toBeLessThanOrEqual(5);
      expect(page.example).toBeDefined();
      expect(page.related.length).toBeGreaterThan(0);
      for (const target of page.related) {
        expect(contentPageAt(target), `${path} -> ${target}`).toBeDefined();
        expect(target).not.toBe(path);
      }
    },
  );

  it.each(contentPages.map((p) => [contentPath(p), p] as const))(
    "%s: layouts carry their content, step bodies stay short",
    (path, page) => {
      for (const section of page.sections) {
        const where = `${path} / ${section.heading}`;
        for (const step of section.steps ?? []) {
          expect(words(step.body).length, `${where} / ${step.title}`).toBeLessThanOrEqual(25);
        }
        if (section.layout === "steps") expect(section.steps?.length, where).toBeGreaterThan(1);
        if (section.layout === "tiles") expect(section.tiles?.length, where).toBeGreaterThan(1);
        if (section.layout === "fieldmap") expect(section.fieldmap, where).toBeDefined();
        if (section.layout === "does-doesnt") {
          for (const list of [section.does ?? [], section.doesnt ?? []]) {
            expect(list.length, where).toBeGreaterThanOrEqual(3);
            expect(list.length, where).toBeLessThanOrEqual(5);
          }
        }
      }
      expect(page.exampleAfter ?? 1).toBeLessThanOrEqual(page.sections.length);
    },
  );

  it("the field map points each CSV column at a real receipt line", () => {
    for (const page of contentPages) {
      for (const section of page.sections) {
        const map = section.fieldmap;
        if (!map) continue;
        for (const field of map.fields) {
          if (field.from !== undefined) expect(map.lines[field.from], field.name).toBeDefined();
          else expect(field.note, field.name).toBeTruthy();
        }
      }
    }
  });

  // A keyword-swapped clone shares most of its vocabulary with the original.
  it("pages are distinct, not clones of each other", () => {
    const sets = contentPages.map((p) => new Set(words(prose(p)).filter((w) => w.length > 3)));
    for (let i = 0; i < sets.length; i++) {
      for (let j = i + 1; j < sets.length; j++) {
        const a = sets[i]!;
        const b = sets[j]!;
        const shared = [...a].filter((w) => b.has(w)).length;
        const jaccard = shared / (a.size + b.size - shared);
        expect(jaccard, `${contentPages[i]!.slug} vs ${contentPages[j]!.slug}`).toBeLessThan(0.35);
      }
    }
  });

  it("claim only outputs and features the product has", () => {
    for (const page of contentPages) {
      const text = `${page.title} ${page.description} ${prose(page)}`;
      expect(text, page.slug).not.toMatch(/excel|xlsx|\bAPI\b|quickbooks|xero|integrat/i);
      // Plain copy for an international reader.
      expect(text, page.slug).not.toMatch(/tax season|shoebox|\bApril\b/i);
    }
  });

  it("examples add up the way the receipt page checks them", () => {
    for (const page of contentPages) {
      const r = page.example!.extraction;
      const base = r.subtotal ?? r.items.reduce((sum, item) => sum + item.totalPrice, 0);
      expect(Math.abs(base + (r.tax ?? 0) + (r.tip ?? 0) - r.total), page.slug).toBeLessThan(0.01);
      for (const item of r.items) {
        expect(
          Math.abs(item.quantity * item.unitPrice - item.totalPrice),
          `${page.slug} ${item.name}`,
        ).toBeLessThan(0.01);
      }
    }
  });

  it("the Receipts CSV example is what the real exporter writes", () => {
    const page = contentPages.find((p) => p.example?.exportView === "history-csv")!;
    const lines = exampleCsv(page.example!).trimEnd().split("\n");
    expect(lines[0]).toMatch(
      /^receipt_id,status,merchant,receipt_date,receipt_date_bs,category,currency,/,
    );
    expect(lines).toHaveLength(1 + 1 + (page.example!.historyRows?.length ?? 0));
    expect(lines[1]).toContain(page.example!.extraction.merchant);
    expect(lines[1]).toContain(page.example!.extraction.total.toFixed(2));
  });
});

describe("content JSON-LD", () => {
  it.each(contentPages.map((p) => [contentPath(p), p] as const))(
    "%s: breadcrumb, WebPage tied to the site, and an FAQPage matching the visible FAQ",
    (path, page) => {
      const graph = contentJsonLd(page)["@graph"] as Array<Record<string, unknown>>;
      expect(graph.map((n) => n["@type"])).toEqual([
        "BreadcrumbList",
        "WebPage",
        "FAQPage",
        "WebSite",
        "WebApplication",
      ]);
      // Every @id the graph points at is defined in the same graph.
      const ids = new Set(graph.map((n) => n["@id"]));
      for (const ref of JSON.stringify(graph).matchAll(/\{"@id":"([^"]+)"\}/g)) {
        expect(ids.has(ref[1]), ref[1]).toBe(true);
      }
      const [crumbs, webPage, faq] = graph as [
        { itemListElement: Array<{ position: number; item: string; name: string }> },
        Record<string, unknown>,
        { mainEntity: Array<{ name: string; acceptedAnswer: { text: string } }> },
      ];
      expect(crumbs.itemListElement.map((c) => c.item)).toEqual([
        abs("/"),
        abs("/use-cases"),
        abs(path),
      ]);
      expect(crumbs.itemListElement.map((c) => c.position)).toEqual([1, 2, 3]);
      expect(webPage).toMatchObject({
        url: abs(path),
        name: fullTitle(page.title),
        description: page.description,
        dateModified: page.updated,
        isPartOf: { "@id": siteNodeIds().website },
        about: { "@id": siteNodeIds().app },
      });
      expect(faq.mainEntity.map((q) => [q.name, q.acceptedAnswer.text])).toEqual(
        page.faqs.map((f) => [f.q, f.a]),
      );
      expect(JSON.stringify(graph)).not.toMatch(/aggregateRating|"review"|ratingValue/i);
    },
  );

  it("the hub lists every page in its collection", () => {
    for (const collection of contentCollections) {
      const graph = collectionJsonLd(collection)["@graph"] as Array<Record<string, unknown>>;
      const hub = graph.find((n) => n["@type"] === "CollectionPage") as {
        mainEntity: { itemListElement: Array<{ url: string }> };
      };
      expect(hub.mainEntity.itemListElement.map((i) => i.url)).toEqual(
        pagesIn(collection.id).map((p) => abs(contentPath(p))),
      );
    }
  });
});

describe("content pages are discoverable", () => {
  const paths = titled.map((e) => e.path);

  it("every hub and page is in the sitemap with its own lastModified", () => {
    const entries = sitemap();
    for (const path of paths) {
      expect(
        entries.map((e) => e.url),
        path,
      ).toContain(abs(path));
    }
    for (const page of contentPages) {
      const entry = entries.find((e) => e.url === abs(contentPath(page)));
      expect(entry?.lastModified).toBe(page.updated);
    }
  });

  it("llms.txt and llms-full.txt link every hub and page", () => {
    for (const text of [llmsTxt(), llmsFullTxt()]) {
      for (const path of paths) expect(text, path).toContain(`(${abs(path)})`);
    }
  });

  it("the footer has a column per collection linking each of its pages", () => {
    const columns = contentFooterColumns();
    expect(columns.map((c) => c.title)).toEqual(contentCollections.map((c) => c.label));
    expect(columns.flatMap((c) => c.links.map((l) => l.href))).toEqual(
      contentPages.map(contentPath),
    );
  });
});
