import { Button } from "@receipt-ocr/ui/components/button";
import { Card } from "@receipt-ocr/ui/components/card";
import { ArrowRight, ChevronRight, Plus } from "lucide-react";
import Link from "next/link";
import { HeroArt } from "@/components/content/content-art";
import { ContentExampleView } from "@/components/content/content-example";
import { FactTiles, IconTile, SectionBody } from "@/components/content/content-sections";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader, type NavLink } from "@/components/site-header";
import { SupportWidget } from "@/components/support-widget";
import {
  collectionById,
  collectionJsonLd,
  contentBreadcrumbs,
  contentJsonLd,
  contentPageAt,
  contentPath,
  pagesIn,
} from "@/lib/content";
import type {
  ContentCollection,
  ContentPage,
  ContentSection,
  HeroArtName,
} from "@/lib/content/types";
import { jsonLdScript } from "@/lib/seo";

const focusRing = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

const navLinks = (collection: ContentCollection): NavLink[] => [
  { href: "/#how", label: "How it works" },
  { href: collection.path, label: collection.label },
  { href: "/pricing", label: "Pricing" },
  { href: "/#faq", label: "FAQ" },
];

function Breadcrumbs({ trail }: { trail: Array<{ name: string; path: string }> }) {
  return (
    <nav aria-label="Breadcrumb">
      <ol className="flex flex-wrap items-center gap-1 font-mono text-xs text-muted-foreground">
        {trail.map((crumb, index) => {
          const last = index === trail.length - 1;
          return (
            <li className="flex items-center gap-1" key={crumb.path}>
              {last ? (
                <span aria-current="page" className="text-foreground">
                  {crumb.name}
                </span>
              ) : (
                <>
                  <Link
                    className={`inline-flex min-h-11 items-center rounded-sm transition-colors hover:text-foreground md:min-h-0 ${focusRing}`}
                    href={crumb.path}
                  >
                    {crumb.name}
                  </Link>
                  <ChevronRight aria-hidden className="size-3" />
                </>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function SignUpButton({ size }: { size?: "lg" }) {
  return (
    <Button asChild size={size}>
      <Link href="/sign-up">
        Get started free <ArrowRight className="size-4" />
      </Link>
    </Button>
  );
}

function Shell({
  collection,
  jsonLd,
  children,
}: {
  collection: ContentCollection;
  jsonLd: Record<string, unknown>;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen overflow-hidden bg-background text-foreground">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdScript(jsonLd) }}
      />
      <SiteHeader links={navLinks(collection)} />
      <main>{children}</main>
      <SiteFooter />
      <SupportWidget />
    </div>
  );
}

function Hero({
  trail,
  eyebrow,
  h1,
  intro,
  art,
  fact,
}: {
  trail: Array<{ name: string; path: string }>;
  eyebrow: string;
  h1: string;
  intro: string;
  art: HeroArtName;
  /** The page's own fact tile; hubs have none. */
  fact?: string;
}) {
  return (
    <section className="relative px-5 pb-14 pt-32 md:pt-40">
      <div className="grid-mask pointer-events-none absolute inset-0 opacity-30">
        <div className="receipt-grid absolute -inset-1" />
      </div>
      <div className="relative mx-auto max-w-5xl">
        <div className="grid items-center gap-10 lg:grid-cols-[1fr_320px]">
          <div>
            <Breadcrumbs trail={trail} />
            <p className="mt-6 font-mono text-xs uppercase tracking-[0.22em] text-primary">
              {eyebrow}
            </p>
            <h1 className="mt-3 text-balance text-3xl font-bold tracking-tight md:text-5xl">
              {h1}
            </h1>
            <p className="mt-5 max-w-2xl text-pretty text-lg leading-8 text-muted-foreground">
              {intro}
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <SignUpButton />
              <Button asChild variant="outline">
                <Link href="/#how">See how it works</Link>
              </Button>
            </div>
          </div>
          <div className="hidden justify-center lg:flex">
            <HeroArt name={art} />
          </div>
        </div>
        {fact ? (
          <div className="mt-12">
            <FactTiles fact={fact} />
          </div>
        ) : null}
      </div>
    </section>
  );
}

function PageCards({ pages }: { pages: ContentPage[] }) {
  return (
    <ul className="grid gap-4 sm:grid-cols-2">
      {pages.map((page) => (
        <li key={page.slug}>
          <Card className="group relative h-full p-6 transition hover:border-primary/40">
            <div className="flex items-center gap-3">
              <IconTile icon={page.icon} />
              <p className="font-mono text-2xs uppercase tracking-[0.18em] text-primary">
                {page.navLabel}
              </p>
            </div>
            <h3 className="mt-4 font-semibold">
              {/* The link covers the whole card; one tab stop per card. */}
              <Link
                className={`rounded-sm after:absolute after:inset-0 after:rounded-lg ${focusRing}`}
                href={contentPath(page)}
              >
                {page.h1}
              </Link>
            </h3>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">{page.description}</p>
            <span className="mt-4 inline-flex items-center gap-1 text-sm text-primary">
              Read more <ArrowRight aria-hidden className="size-4" />
            </span>
          </Card>
        </li>
      ))}
    </ul>
  );
}

function Cta({ heading, body }: { heading: string; body: string }) {
  return (
    <section className="px-5 py-20 md:py-24">
      <div className="relative mx-auto max-w-4xl overflow-hidden rounded-3xl border border-primary/20 bg-primary/6 px-6 py-14 text-center">
        <div className="glow-orb pointer-events-none absolute left-1/2 top-full size-[500px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary/15 blur-[130px]" />
        <div className="relative">
          <h2 className="text-balance text-2xl font-bold tracking-tight md:text-3xl">{heading}</h2>
          <p className="mx-auto mt-4 max-w-md text-pretty text-muted-foreground">{body}</p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <SignUpButton size="lg" />
            <Button asChild size="lg" variant="outline">
              <Link href="/pricing">See pricing</Link>
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}

const h2Class = "text-2xl font-bold tracking-tight";

/** A section: heading and prose at reading width, then its layout at full width. */
function Section({ section }: { section: ContentSection }) {
  return (
    <section>
      <div className="max-w-3xl">
        <h2 className={h2Class}>{section.heading}</h2>
        {section.paragraphs?.map((paragraph) => (
          <p className="mt-4 leading-7 text-muted-foreground" key={paragraph}>
            {paragraph}
          </p>
        ))}
        {section.bullets ? (
          <ul className="mt-4 list-disc space-y-2 pl-5 leading-7 text-muted-foreground marker:text-primary">
            {section.bullets.map((bullet) => (
              <li key={bullet}>{bullet}</li>
            ))}
          </ul>
        ) : null}
      </div>
      {section.layout && section.layout !== "prose" ? (
        <div className="mt-6">
          <SectionBody section={section} />
        </div>
      ) : null}
    </section>
  );
}

/** One content page: hero, sections with the sample receipt early, FAQ, related pages and a CTA. */
export function ContentPageView({ page }: { page: ContentPage }) {
  const collection = collectionById(page.collection);
  const related = page.related.map(contentPageAt).filter((p): p is ContentPage => Boolean(p));
  const split = page.exampleAfter ?? 1;
  return (
    <Shell collection={collection} jsonLd={contentJsonLd(page)}>
      <Hero
        art={page.heroArt}
        eyebrow={collection.label}
        fact={page.fact}
        h1={page.h1}
        intro={page.intro}
        trail={contentBreadcrumbs(page)}
      />

      <div className="px-5">
        <article className="mx-auto flex max-w-5xl flex-col gap-16 border-t border-border pt-14">
          {page.sections.slice(0, split).map((section) => (
            <Section key={section.heading} section={section} />
          ))}

          {page.example ? (
            <section aria-labelledby="example-heading">
              <p className="font-mono text-xs uppercase tracking-[0.22em] text-primary">Example</p>
              <h2 className={`mt-2 ${h2Class}`} id="example-heading">
                {page.example.heading}
              </h2>
              <div className="mt-6">
                <ContentExampleView example={page.example} />
              </div>
            </section>
          ) : null}

          {page.sections.slice(split).map((section) => (
            <Section key={section.heading} section={section} />
          ))}

          <section aria-labelledby="faq-heading" className="max-w-3xl">
            <h2 className={h2Class} id="faq-heading">
              Questions
            </h2>
            {/* Native disclosure: no client JS, and every answer is in the HTML. */}
            <div className="mt-6 flex flex-col divide-y divide-border rounded-xl border border-border">
              {page.faqs.map((faq) => (
                <details className="group/faq px-5" key={faq.q}>
                  <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-4 rounded-md py-5 text-left text-sm font-medium text-foreground outline-none transition-colors hover:text-primary focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
                    {faq.q}
                    <Plus
                      aria-hidden
                      className="size-4 shrink-0 text-muted-foreground transition-transform duration-200 group-open/faq:rotate-45 group-open/faq:text-primary"
                    />
                  </summary>
                  <p className="pb-5 text-sm leading-7 text-muted-foreground">{faq.a}</p>
                </details>
              ))}
            </div>
          </section>

          {related.length > 0 ? (
            <section aria-labelledby="related-heading">
              <h2 className={h2Class} id="related-heading">
                Related {collection.label.toLowerCase()}
              </h2>
              <div className="mt-6">
                <PageCards pages={related} />
              </div>
              <p className="mt-6 text-sm">
                <Link
                  className={`inline-flex min-h-11 items-center rounded-sm text-foreground underline underline-offset-4 md:min-h-0 ${focusRing}`}
                  href={collection.path}
                >
                  All {collection.label.toLowerCase()}
                </Link>
              </p>
            </section>
          ) : null}
        </article>
      </div>

      <Cta body={page.cta.body} heading={page.cta.heading} />
    </Shell>
  );
}

/** A collection's hub page: hero and a card per page. */
export function ContentHubView({ collection }: { collection: ContentCollection }) {
  return (
    <Shell collection={collection} jsonLd={collectionJsonLd(collection)}>
      <Hero
        art={collection.heroArt}
        eyebrow={collection.label}
        h1={collection.h1}
        intro={collection.intro}
        trail={[
          { name: "Home", path: "/" },
          { name: collection.label, path: collection.path },
        ]}
      />
      <div className="px-5">
        <div className="mx-auto max-w-5xl border-t border-border pt-12">
          <h2 className="sr-only">All {collection.label.toLowerCase()}</h2>
          <PageCards pages={pagesIn(collection.id)} />
        </div>
      </div>
      <Cta
        body="Free to start, no card required. Upload a receipt and see what comes out."
        heading="Try it on your own receipts"
      />
    </Shell>
  );
}
