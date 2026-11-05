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
  Globe2,
  KeyRound,
  ScanLine,
  Search,
  Shield,
  Users,
} from "lucide-react";
import Link from "next/link";
import { Brand } from "@/components/brand";
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
    desc: "Merchant, dates, line items, tax, and totals pulled into clean fields — each with a confidence score so you know what to trust.",
  },
  {
    icon: KeyRound,
    title: "Bring your own keys",
    desc: "Start fully managed on the free tier. Outgrow it? Plug in your own AI and storage keys to lift the limits and pay providers directly — no markup.",
  },
  {
    icon: Shield,
    title: "Private by design",
    desc: "Every receipt and route is protected, and your storage keys stay server-side — never exposed to the browser.",
  },
  {
    icon: Download,
    title: "Export anywhere",
    desc: "Send structured results to JSON or CSV in a click — straight into your spreadsheet, ledger, or pipeline.",
  },
  {
    icon: Search,
    title: "Searchable history",
    desc: "Every receipt is stored, statused, and searchable — built for repeat finance workflows, not one-offs.",
  },
  {
    icon: Globe2,
    title: "No lock-in",
    desc: "S3-compatible from day one — Cloudflare R2, AWS S3, or self-hosted RustFS. Your data stays portable.",
  },
];

const stats: Array<[string, string]> = [
  ["100%", "Of line items captured, not just the total"],
  ["Every field", "Scored with its own confidence value"],
  ["JSON + CSV", "Export formats, one click away"],
  ["$0", "To start — no card required"],
];

const steps = [
  {
    title: "Upload a receipt",
    desc: "Snap a photo or drop in an image. Uploads are handled server-side, so storage keys never touch the browser.",
  },
  {
    title: "Get structured data",
    desc: "Fields are extracted into clean, structured data in seconds — merchant, items, tax, and totals, each with a confidence score.",
  },
  {
    title: "Review, search, export",
    desc: "Everything lands in your searchable history, ready to review and export to JSON or CSV whenever you need it.",
  },
];

const useCases = [
  {
    icon: Briefcase,
    title: "Founders & freelancers",
    desc: "Keep expenses in order without hand-typing every receipt at tax time.",
  },
  {
    icon: Calculator,
    title: "Bookkeepers",
    desc: "Pull line-item detail straight into ledgers — totals, tax, and items, scored for review.",
  },
  {
    icon: Code2,
    title: "Developers",
    desc: "Receipts in, clean JSON out. Wire it into your own pipeline with portable storage.",
  },
  {
    icon: Users,
    title: "Small teams",
    desc: "A shared, searchable history so nothing gets lost between people or months.",
  },
];

const faqs = [
  {
    q: "What image formats can I upload?",
    a: "PNG, JPG, and HEIC images up to 10MB. Snap a photo on your phone or drop in a scan — both work.",
  },
  {
    q: "How accurate is the extraction?",
    a: "Every field — merchant, date, each line item, tax, and total — comes back with its own confidence score, so you always know exactly what to trust and what to double-check.",
  },
  {
    q: "What does “bring your own keys” mean?",
    a: "Start on the managed free tier with zero setup. When you outgrow it, plug in your own AI and storage keys to lift the limits and pay providers directly — no markup, no lock-in.",
  },
  {
    q: "Where is my receipt data stored?",
    a: "In S3-compatible storage — Cloudflare R2, AWS S3, or self-hosted RustFS. Your storage keys stay server-side and your data stays portable and yours.",
  },
  {
    q: "Is it really free to start?",
    a: "Yes. The free tier needs no credit card. You only ever bring your own keys or talk to us when you genuinely need higher volume.",
  },
  {
    q: "Can I export what gets extracted?",
    a: "Any receipt exports to JSON or CSV in a click — ready for your spreadsheet, ledger, or data pipeline.",
  },
];

const freePlanFeatures = [
  "Receipt OCR with confidence scores",
  "Merchant, items, tax & totals extracted",
  "Searchable receipt history",
  "JSON & CSV export",
  "Bring your own keys to lift limits",
];

const customPlanFeatures = [
  "Everything in Free",
  "Higher request & storage limits",
  "Help wiring your own providers",
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
            Snap or upload any receipt and get clean, structured data — merchant, line items, tax,
            and totals — ready to search, review, and export.
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
            No card required · Bring your own keys when you outgrow the free tier
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
              A complete pipeline — capture, extract, review, and export — with your data staying
              yours the whole way through.
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
              Built for anyone drowning in receipts
            </h2>
            <p className="mt-4 text-pretty text-muted-foreground">
              From a single founder at tax time to a team that needs every line item — the same
              clean data, ready when you are.
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
              No credit card to begin. When you outgrow the free tier, bring your own keys — or talk
              to us about higher volume.
            </p>
          </div>
          <div className="mx-auto grid max-w-3xl items-stretch gap-5 md:grid-cols-2">
            <PlanCard
              name="Free"
              price="$0"
              cadence="/ forever"
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
              Still curious? Reach out any time — we read every message.
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
              Free to start, no card required. Bring your own keys when you&apos;re ready to scale —
              your data, your costs, no lock-in.
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
