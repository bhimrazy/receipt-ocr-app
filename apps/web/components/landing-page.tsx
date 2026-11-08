import { Button } from "@receipt-ocr/ui/components/button";
import { Card } from "@receipt-ocr/ui/components/card";
import { cn } from "@receipt-ocr/ui/lib/utils";
import {
  ArrowRight,
  Briefcase,
  Calculator,
  Code2,
  Download,
  ListChecks,
  Plus,
  ScanLine,
  Search,
  Shield,
  Users,
} from "lucide-react";
import Link from "next/link";
import { HeroFloatingReceipts } from "@/components/hero-floating-receipts";
import { LandingInstallOffer } from "@/components/landing-install";
import { PlanCard } from "@/components/plan-card";
import { ProductPreview } from "@/components/product-preview";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { SupportWidget } from "@/components/support-widget";
import { homeFaqs as faqs } from "@/lib/home-faqs";
import { freeFeatures, proFeatures } from "@/lib/plan-copy";
import { PRO_PRICE_LABEL } from "@/lib/pricing";
import { homeJsonLd, jsonLdScript } from "@/lib/seo";
import type { PlanTable } from "@receipt-ocr/core/plans";

const features = [
  {
    icon: ScanLine,
    title: "Accurate extraction",
    desc: "Merchant, date, line items, tax, and totals pulled into clean fields, with a confidence score for the receipt and for each line so you know what to check.",
  },
  {
    icon: ListChecks,
    title: "Checks before you trust it",
    desc: "Low-confidence lines are marked, and totals that don't add up are flagged, so you know which receipts to look at twice.",
  },
  {
    icon: Shield,
    title: "Private by design",
    desc: "Receipts are private to your workspace. Photos your browser can open are re-encoded before upload, which removes camera location data.",
  },
  {
    icon: Download,
    title: "Export anywhere",
    desc: "Export any receipt as CSV or copy it as JSON, or download your whole filtered history as one CSV for your spreadsheet.",
  },
  {
    icon: Search,
    title: "Searchable history",
    desc: "Every receipt is kept with its status, so you can search it and filter by what still needs checking.",
  },
  {
    icon: Users,
    title: "Shared workspaces",
    desc: "Invite the people you work with. Everyone uploads into the same history, so receipts aren't scattered across phones.",
  },
];

const stats: Array<[string, string]> = [
  ["Line items", "Scanned too, not just the total"],
  ["Confidence", "Per receipt and per line"],
  ["CSV + JSON", "Export as CSV, copy as JSON"],
  ["$0", "To start, no card required"],
];

const steps = [
  {
    title: "Upload a receipt",
    desc: "Take a photo or drop in photos or PDFs, up to 20 at a time. Large phone photos are shrunk before they upload.",
  },
  {
    title: "Get structured data",
    desc: "Merchant, date, items, tax, and totals are scanned in seconds, with a confidence score to show what needs a second look.",
  },
  {
    title: "Review, search, export",
    desc: "Everything lands in your searchable history, ready to review and export to CSV whenever you need it.",
  },
];

const useCases: Array<{ icon: typeof Users; title: string; href?: string; desc: string }> = [
  {
    icon: Briefcase,
    title: "Founders & freelancers",
    href: "/use-cases/freelancers-taxes",
    desc: "Keep expenses in order without typing every receipt by hand.",
  },
  {
    icon: Calculator,
    title: "Bookkeepers",
    href: "/use-cases/bookkeeping",
    desc: "Tax, totals and confidence for every receipt in one CSV, with a Needs review filter for the ones to check.",
  },
  {
    icon: Code2,
    title: "Developers",
    desc: "Receipts in, clean JSON out, ready for your own scripts and spreadsheets.",
  },
  {
    icon: Users,
    title: "Small teams",
    href: "/use-cases/small-businesses",
    desc: "A shared, searchable history so nothing gets lost between people or months.",
  },
];

// The FAQ entity mirrors the visible FAQ section below; keep the two in step.
const faqJsonLd = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: faqs.map((faq) => ({
    "@type": "Question",
    name: faq.q,
    acceptedAnswer: { "@type": "Answer", text: faq.a },
  })),
};

const siteJsonLd = homeJsonLd();

function SectionLabel({ children }: { children: string }) {
  return <p className="font-mono text-xs uppercase tracking-[0.22em] text-primary">{children}</p>;
}

export function LandingPage({ plans }: { plans: PlanTable }) {
  return (
    <div className="min-h-screen overflow-hidden bg-background text-foreground">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdScript(siteJsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdScript(faqJsonLd) }}
      />
      <SiteHeader />

      <main>
        {/* Hero */}
        <section className="relative flex items-center justify-center px-5 pb-28 pt-40 text-center md:pt-44">
          <div className="grid-mask pointer-events-none absolute inset-0 opacity-40">
            <div className="receipt-grid absolute -inset-1" />
          </div>
          <div className="hero-aurora pointer-events-none absolute left-1/2 top-[36%] size-[780px] -translate-x-1/2 -translate-y-1/2 rounded-full" />
          <HeroFloatingReceipts />

          <div className="relative z-10 mx-auto max-w-3xl animate-rise">
            <div className="mb-7 inline-flex items-center gap-2 rounded-full border border-hairline bg-wash-subtle px-4 py-1.5 font-mono text-xs text-muted-foreground">
              <span className="size-1.5 rounded-full bg-primary shadow-[0_0_10px_var(--primary)]" />
              Early access · Free to start
            </div>
            <h1 className="text-balance text-5xl font-bold leading-[1.05] tracking-tight md:text-7xl">
              <span className="block">Receipts to</span>
              <span className="text-gradient block">structured data</span>
            </h1>
            <p className="mx-auto mt-6 max-w-xl text-pretty text-base leading-8 text-foreground/80 md:text-lg">
              Snap or upload any receipt and get clean, structured data: merchant, line items, tax,
              and totals, ready to search, review, and export.
            </p>
            <div className="mt-9 flex flex-wrap justify-center gap-3">
              <Button asChild size="lg">
                <Link href="/sign-up">
                  Get started free <ArrowRight className="size-4" />
                </Link>
              </Button>
              <Button asChild variant="outline" size="lg">
                <a href="#how">See how it works</a>
              </Button>
            </div>
            <p className="mt-5 font-mono text-xs text-muted-foreground">
              No card required · Photos and PDFs
            </p>
          </div>
        </section>

        {/* Product preview */}
        <section className="relative px-5 pb-8">
          <div className="mx-auto -mt-6 max-w-4xl animate-rise">
            <ProductPreview />
          </div>
        </section>

        {/* Stats band */}
        <section className="mt-16 border-y border-border bg-secondary/30 px-5 py-12">
          <div className="mx-auto grid max-w-5xl grid-cols-2 gap-x-8 gap-y-10 text-center md:grid-cols-4">
            {stats.map(([value, label]) => (
              <div key={label}>
                <div className="font-mono text-xl font-bold tracking-tight text-foreground md:text-2xl">
                  {value}
                </div>
                <div className="mt-2 text-sm text-muted-foreground">{label}</div>
              </div>
            ))}
          </div>
        </section>

        {/* Features */}
        <section id="features" className="relative scroll-mt-24 px-5 py-24 md:py-28">
          <div className="glow-orb pointer-events-none absolute left-1/2 top-0 size-[500px] -translate-x-1/2 rounded-full bg-primary/5 blur-[160px]" />
          <div className="relative mx-auto max-w-6xl">
            <div className="mx-auto mb-14 max-w-2xl text-center">
              <SectionLabel>What you get</SectionLabel>
              <h2 className="mt-3 text-3xl font-bold tracking-tight md:text-4xl">
                Everything from snap to export
              </h2>
              <p className="mt-4 text-pretty text-muted-foreground">
                Capture, extract, review, and export in one place, with your data staying yours the
                whole way through.
              </p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {features.map((feature) => {
                const Icon = feature.icon;
                return (
                  <Card
                    className="group relative overflow-hidden p-6 transition duration-300 hover:-translate-y-1 hover:border-primary/40 hover:shadow-xl hover:shadow-primary/5"
                    key={feature.title}
                  >
                    <div className="absolute -right-12 -top-12 size-32 rounded-full bg-primary/0 blur-3xl transition duration-300 group-hover:bg-primary/10" />
                    <div className="mb-4 flex size-11 items-center justify-center rounded-xl border border-primary/20 bg-primary/10 text-primary transition group-hover:scale-105 group-hover:bg-primary/15">
                      <Icon className="size-5" />
                    </div>
                    <h3 className="font-semibold">{feature.title}</h3>
                    <p className="mt-2 text-sm leading-6 text-muted-foreground">{feature.desc}</p>
                  </Card>
                );
              })}
            </div>
          </div>
        </section>

        {/* How it works */}
        <section
          id="how"
          className="scroll-mt-24 border-t border-border bg-secondary/20 px-5 py-24 md:py-28"
        >
          <div className="mx-auto max-w-6xl">
            <div className="mx-auto mb-14 max-w-2xl text-center">
              <SectionLabel>How it works</SectionLabel>
              <h2 className="mt-3 text-3xl font-bold tracking-tight md:text-4xl">
                Upload, extract, export
              </h2>
              <p className="mt-4 text-pretty text-muted-foreground">
                Three steps from a photo on your phone to clean data you can actually use.
              </p>
            </div>
            <div className="relative grid gap-5 md:grid-cols-3">
              {/* connector line */}
              <div className="pointer-events-none absolute inset-x-[16%] top-[3.25rem] hidden h-px bg-linear-to-r from-transparent via-border to-transparent md:block" />
              {steps.map((step, index) => (
                <Card className="relative p-7 text-center" key={step.title}>
                  <div className="relative z-10 mx-auto mb-5 flex size-14 items-center justify-center rounded-2xl border border-primary/20 bg-background font-mono text-lg font-bold text-primary shadow-[0_0_24px_color-mix(in_oklab,var(--primary)_18%,transparent)]">
                    {String(index + 1).padStart(2, "0")}
                  </div>
                  <h3 className="font-semibold">{step.title}</h3>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">{step.desc}</p>
                </Card>
              ))}
            </div>
          </div>
        </section>

        {/* Use cases */}
        <section className="border-t border-border px-5 py-24 md:py-28">
          <div className="mx-auto max-w-6xl">
            <div className="mx-auto mb-14 max-w-2xl text-center">
              <SectionLabel>Who it&apos;s for</SectionLabel>
              <h2 className="mt-3 text-3xl font-bold tracking-tight md:text-4xl">
                Built for anyone with a pile of receipts
              </h2>
              <p className="mt-4 text-pretty text-muted-foreground">
                From a single freelancer to a team that needs every line item, the same clean data
                comes out.
              </p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {useCases.map((useCase) => {
                const Icon = useCase.icon;
                return (
                  <Card
                    className={cn(
                      "relative p-6",
                      useCase.href && "transition hover:border-primary/40",
                    )}
                    key={useCase.title}
                  >
                    <div className="mb-4 flex size-11 items-center justify-center rounded-xl border border-primary/20 bg-primary/10 text-primary">
                      <Icon className="size-5" />
                    </div>
                    <h3 className="font-semibold">
                      {useCase.href ? (
                        // The link covers the whole card.
                        <Link
                          className="rounded-sm after:absolute after:inset-0 after:rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          href={useCase.href}
                        >
                          {useCase.title}
                        </Link>
                      ) : (
                        useCase.title
                      )}
                    </h3>
                    <p className="mt-2 text-sm leading-6 text-muted-foreground">{useCase.desc}</p>
                  </Card>
                );
              })}
            </div>
            <p className="mt-8 text-center text-sm">
              <Link
                className="inline-flex min-h-11 items-center gap-1 rounded-sm text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                href="/use-cases"
              >
                See how each of them uses ReceiptOCR <ArrowRight aria-hidden className="size-4" />
              </Link>
            </p>
          </div>
        </section>

        {/* Pricing */}
        <section
          id="pricing"
          className="scroll-mt-24 border-t border-border bg-secondary/20 px-5 py-24 md:py-28"
        >
          <div className="mx-auto max-w-5xl">
            <div className="mx-auto mb-14 max-w-2xl text-center">
              <SectionLabel>Pricing</SectionLabel>
              <h2 className="mt-3 text-3xl font-bold tracking-tight md:text-4xl">
                Start free, scale when you need
              </h2>
              <p className="mt-4 text-pretty text-muted-foreground">
                No credit card to begin. When a workspace needs more, Pro is {PRO_PRICE_LABEL.month}{" "}
                a month or {PRO_PRICE_LABEL.year} a year.
              </p>
            </div>
            <div className="mx-auto grid max-w-3xl items-stretch gap-5 md:grid-cols-2">
              <PlanCard
                name="Free"
                price="$0"
                cadence=""
                badge="Start here"
                description="Everything you need to start turning receipts into structured data."
                features={freeFeatures(plans.free)}
                cta={
                  <Button asChild className="w-full">
                    <Link href="/sign-up">
                      Get started free <ArrowRight className="size-4" />
                    </Link>
                  </Button>
                }
              />
              <PlanCard
                name="Pro"
                price={PRO_PRICE_LABEL.month}
                cadence="a month per workspace"
                description={`Or ${PRO_PRICE_LABEL.year} a year. Plus sales tax or VAT where it applies.`}
                features={proFeatures(plans.pro)}
                featured
                cta={
                  <Button asChild className="w-full" variant="outline">
                    <Link href="/pricing">
                      See pricing <ArrowRight className="size-4" />
                    </Link>
                  </Button>
                }
              />
            </div>
          </div>
        </section>

        {/* FAQ */}
        <section id="faq" className="scroll-mt-24 border-t border-border px-5 py-24 md:py-28">
          <div className="mx-auto max-w-3xl">
            <div className="mx-auto mb-12 max-w-2xl text-center">
              <SectionLabel>FAQ</SectionLabel>
              <h2 className="mt-3 text-3xl font-bold tracking-tight md:text-4xl">
                Questions, answered
              </h2>
              <p className="mt-4 text-pretty text-muted-foreground">
                Still curious? Reach out any time. We read every message.
              </p>
            </div>
            {/* Native disclosure: no client JS, and every answer is in the HTML. */}
            <div className="flex w-full flex-col divide-y divide-border rounded-xl border border-border">
              {faqs.map((faq) => (
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
          </div>
        </section>

        {/* CTA */}
        <section className="px-5 py-24 md:py-28">
          <div className="relative mx-auto max-w-4xl overflow-hidden rounded-3xl border border-primary/20 bg-primary/6 px-6 py-16 text-center">
            <div className="grid-mask pointer-events-none absolute inset-0 opacity-30">
              <div className="receipt-grid absolute -inset-1" />
            </div>
            <div className="glow-orb pointer-events-none absolute left-1/2 top-full size-[500px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary/15 blur-[130px]" />
            <div className="relative">
              <h2 className="text-balance text-3xl font-bold tracking-tight md:text-4xl">
                Start turning receipts into data
              </h2>
              <p className="mx-auto mt-4 max-w-md text-pretty text-muted-foreground">
                Free to start, no card required. Export everything, any time.
              </p>
              <div className="mt-8 flex flex-wrap justify-center gap-3">
                <Button asChild size="lg">
                  <Link href="/sign-up">
                    Get started free <ArrowRight className="size-4" />
                  </Link>
                </Button>
                <Button asChild variant="outline" size="lg">
                  <a href="#features">Explore features</a>
                </Button>
              </div>
            </div>
          </div>
        </section>
      </main>

      <SiteFooter />
      <SupportWidget />
      <LandingInstallOffer />
    </div>
  );
}
