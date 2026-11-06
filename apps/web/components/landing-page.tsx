import { Accordion, AccordionItem } from "@receipt-ocr/ui/components/accordion";
import { Badge } from "@receipt-ocr/ui/components/badge";
import { Button } from "@receipt-ocr/ui/components/button";
import { Card } from "@receipt-ocr/ui/components/card";
import {
  ArrowRight,
  Briefcase,
  Calculator,
  Check,
  Code2,
  Download,
  ListChecks,
  ScanLine,
  Search,
  Shield,
  Users,
} from "lucide-react";
import Link from "next/link";
import { ContactButton } from "@/components/contact-button";
import { HeroFloatingReceipts } from "@/components/hero-floating-receipts";
import { ProductPreview } from "@/components/product-preview";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { SupportWidget } from "@/components/support-widget";

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
  ["Line items", "Read too, not just the total"],
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
    desc: "Merchant, date, items, tax, and totals are read in seconds, with a confidence score to show what needs a second look.",
  },
  {
    title: "Review, search, export",
    desc: "Everything lands in your searchable history, ready to review and export to CSV whenever you need it.",
  },
];

const useCases = [
  {
    icon: Briefcase,
    title: "Founders & freelancers",
    desc: "Keep expenses in order without typing every receipt by hand.",
  },
  {
    icon: Calculator,
    title: "Bookkeepers",
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
    desc: "A shared, searchable history so nothing gets lost between people or months.",
  },
];

const faqs = [
  {
    q: "What file formats can I upload?",
    a: "JPEG, PNG, WebP, HEIC or PDF. Phone photos are shrunk in your browser before upload; PDFs up to 4 MB.",
  },
  {
    q: "How accurate is the extraction?",
    a: "Each receipt gets an overall confidence score and each line item gets its own. Receipts below the threshold, lines that were hard to read, and totals that don't add up are flagged so you know what to check.",
  },
  {
    q: "Where is my receipt data stored?",
    a: "Receipt files are kept in private cloud storage and the extracted data in our database. Receipts are read by Google Gemini; see the privacy policy for details. You can export your data at any time.",
  },
  {
    q: "Is it really free to start?",
    a: "Yes. The free plan needs no credit card and includes a daily allowance of receipt reads. If you need more, contact us.",
  },
  {
    q: "Can I export what gets extracted?",
    a: "Yes. Any receipt exports as CSV with its line items or copies as JSON, and History exports every receipt that matches your filters as one CSV.",
  },
];

const freePlanFeatures = [
  "A daily allowance of receipt reads",
  "Merchant, items, tax & totals extracted",
  "Confidence scores and review flags",
  "Searchable receipt history",
  "CSV export and JSON copy",
];

const customPlanFeatures = [
  "Everything in Free",
  "Higher daily limits",
  "More workspaces",
  "Direct line to the team",
  "Shape the roadmap with your feedback",
];

const faqJsonLd = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: faqs.map((faq) => ({
    "@type": "Question",
    name: faq.q,
    acceptedAnswer: { "@type": "Answer", text: faq.a },
  })),
};

function SectionLabel({ children }: { children: string }) {
  return <p className="font-mono text-xs uppercase tracking-[0.22em] text-primary">{children}</p>;
}

function PlanCard({
  name,
  price,
  cadence,
  description,
  features,
  cta,
  featured = false,
}: {
  name: string;
  price: string;
  cadence: string;
  description: string;
  features: string[];
  cta: React.ReactNode;
  featured?: boolean;
}) {
  return (
    <Card
      className={`card-sheen relative flex flex-col p-7 ${
        featured ? "border-primary/40 bg-primary/4" : ""
      }`}
    >
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">{name}</h3>
        {featured && <Badge>Start here</Badge>}
      </div>
      <div className="mt-3 flex items-baseline gap-1.5">
        <span className="font-mono text-3xl font-bold tracking-tight">{price}</span>
        <span className="text-sm text-muted-foreground">{cadence}</span>
      </div>
      <p className="mt-2 text-sm text-muted-foreground">{description}</p>
      <ul className="mt-6 flex flex-1 flex-col gap-3 text-sm">
        {features.map((feature) => (
          <li className="flex items-start gap-2.5" key={feature}>
            <Check className="mt-0.5 size-4 shrink-0 text-primary" />
            <span>{feature}</span>
          </li>
        ))}
      </ul>
      <div className="mt-7">{cta}</div>
    </Card>
  );
}

export function LandingPage() {
  return (
    <main className="min-h-screen overflow-hidden bg-background text-foreground">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
      />
      <SiteHeader />

      {/* Hero */}
      <section className="relative flex items-center justify-center px-5 pb-28 pt-40 text-center md:pt-44">
        <div className="grid-mask pointer-events-none absolute inset-0 opacity-40">
          <div className="receipt-grid absolute -inset-1" />
        </div>
        <div className="hero-aurora pointer-events-none absolute left-1/2 top-[36%] size-[780px] -translate-x-1/2 -translate-y-1/2 rounded-full" />
        <HeroFloatingReceipts />

        <div className="relative z-10 mx-auto max-w-3xl animate-fade-up">
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
        <div className="mx-auto -mt-6 max-w-4xl animate-fade-up">
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
                <Card className="p-6" key={useCase.title}>
                  <div className="mb-4 flex size-11 items-center justify-center rounded-xl border border-primary/20 bg-primary/10 text-primary">
                    <Icon className="size-5" />
                  </div>
                  <h3 className="font-semibold">{useCase.title}</h3>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">{useCase.desc}</p>
                </Card>
              );
            })}
          </div>
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
              No credit card to begin. If you need more than the free plan, contact us about higher
              volume.
            </p>
          </div>
          <div className="mx-auto grid max-w-3xl items-stretch gap-5 md:grid-cols-2">
            <PlanCard
              name="Free"
              price="$0"
              cadence=""
              description="Everything you need to start turning receipts into structured data."
              features={freePlanFeatures}
              featured
              cta={
                <Button asChild className="w-full">
                  <Link href="/sign-up">
                    Get started free <ArrowRight className="size-4" />
                  </Link>
                </Button>
              }
            />
            <PlanCard
              name="Custom"
              price="Let's talk"
              cadence=""
              description="For higher volume, teams, and tailored setups."
              features={customPlanFeatures}
              cta={
                <ContactButton variant="outline" topic="use-case" className="w-full">
                  Contact us
                </ContactButton>
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
          <Accordion>
            {faqs.map((faq) => (
              <AccordionItem key={faq.q} question={faq.q}>
                {faq.a}
              </AccordionItem>
            ))}
          </Accordion>
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

      <SiteFooter />
      <SupportWidget />
    </main>
  );
}
