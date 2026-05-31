import { Button } from "@receipt-ocr/ui/components/button";
import { Card } from "@receipt-ocr/ui/components/card";
import {
  ArrowRight,
  Check,
  Download,
  Globe2,
  ReceiptText,
  Search,
  Shield,
  Zap,
} from "lucide-react";
import Link from "next/link";
import { Brand } from "@/components/brand";
import { HeroFloatingReceipts } from "@/components/hero-floating-receipts";
import { SiteHeader } from "@/components/site-header";

const features = [
  {
    icon: Zap,
    title: "Provider-ready OCR",
    desc: "Gemini powers the MVP through the AI SDK, with clean seams for future providers.",
  },
  {
    icon: Shield,
    title: "Private by design",
    desc: "Clerk protects every receipt route and storage keys stay server-side.",
  },
  {
    icon: Globe2,
    title: "Portable storage",
    desc: "R2 first, S3-compatible always, so MinIO and AWS S3 remain easy exits.",
  },
  {
    icon: ReceiptText,
    title: "Structured output",
    desc: "Merchant, dates, line items, tax, totals, and confidence in typed JSON.",
  },
  {
    icon: Search,
    title: "Fast history",
    desc: "Searchable, dense receipt records built for repeated finance workflows.",
  },
  {
    icon: Download,
    title: "Exports ready",
    desc: "Result views are shaped for JSON and CSV exports from day one.",
  },
];

const stats: Array<[string, string]> = [
  ["6", "Fields per receipt"],
  ["JSON + CSV", "Export formats"],
  ["S3 / R2", "Portable storage"],
  ["Typed", "End-to-end schema"],
];

const steps = [
  {
    title: "Upload a receipt image",
    desc: "Server-mediated upload keeps storage credentials private.",
  },
  {
    title: "Gemini extracts typed JSON",
    desc: "The AI SDK keeps provider switching realistic later on.",
  },
  {
    title: "Review history and export",
    desc: "Data lands in Postgres with statuses ready for background jobs.",
  },
];

function SectionLabel({ children }: { children: string }) {
  return (
    <p className="font-mono text-xs uppercase tracking-[0.22em] text-primary">{children}</p>
  );
}

export function LandingPage() {
  return (
    <main className="min-h-screen overflow-hidden bg-background text-foreground">
      <SiteHeader />

      {/* Hero */}
      <section className="relative flex items-center justify-center px-5 pb-28 pt-40 text-center md:pt-44">
        <div className="grid-mask pointer-events-none absolute inset-0 opacity-40">
          <div className="receipt-grid absolute -inset-1" />
        </div>
        <div className="hero-aurora pointer-events-none absolute left-1/2 top-[36%] size-[780px] -translate-x-1/2 -translate-y-1/2 rounded-full" />
        <HeroFloatingReceipts />

        <div className="relative z-10 mx-auto max-w-3xl animate-fade-up">
          <div className="mb-7 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-4 py-1.5 font-mono text-xs text-muted-foreground">
            <span className="size-1.5 rounded-full bg-primary shadow-[0_0_10px_var(--primary)]" />
            v0.1 · AI SDK · Effect TS
          </div>
          <h1 className="text-balance text-5xl font-bold leading-[1.05] tracking-tight md:text-7xl">
            <span className="block">Receipts to</span>
            <span className="block bg-gradient-to-r from-primary via-sky-300 to-violet-300 bg-clip-text text-transparent">
              structured data
            </span>
          </h1>
          <p className="mx-auto mt-6 max-w-xl text-pretty text-base leading-8 text-muted-foreground md:text-lg">
            Extract line items, totals, categories, and confidence from receipt images with
            Gemini OCR, Postgres history, and S3-compatible storage.
          </p>
          <div className="mt-9 flex flex-wrap justify-center gap-3">
            <Button asChild size="lg">
              <Link href="/sign-in">
                Get started free <ArrowRight className="size-4" />
              </Link>
            </Button>
            <Button asChild variant="outline" size="lg">
              <a href="#how">See how it works</a>
            </Button>
          </div>
          <p className="mt-5 font-mono text-xs text-muted-foreground/70">
            No card required · Bring your own keys
          </p>
        </div>
      </section>

      {/* Stats band */}
      <section className="border-y border-border bg-secondary/30 px-5 py-12">
        <div className="mx-auto grid max-w-5xl grid-cols-2 gap-x-8 gap-y-10 text-center md:grid-cols-4">
          {stats.map(([value, label]) => (
            <div key={label}>
              <div className="font-mono text-2xl font-bold md:text-3xl">{value}</div>
              <div className="mt-1.5 text-sm text-muted-foreground">{label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Features */}
      <section id="features" className="relative px-5 py-24 md:py-28">
        <div className="glow-orb pointer-events-none absolute left-1/2 top-0 size-[500px] -translate-x-1/2 rounded-full bg-primary/5 blur-[160px]" />
        <div className="relative mx-auto max-w-6xl">
          <div className="mx-auto mb-14 max-w-2xl text-center">
            <SectionLabel>Features</SectionLabel>
            <h2 className="mt-3 text-3xl font-bold tracking-tight md:text-4xl">
              Everything for the MVP
            </h2>
            <p className="mt-4 text-pretty text-muted-foreground">
              A complete receipt pipeline from upload to structured records — typed end to end.
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
      <section id="how" className="border-t border-border bg-secondary/20 px-5 py-24 md:py-28">
        <div className="mx-auto max-w-6xl">
          <div className="mx-auto mb-14 max-w-2xl text-center">
            <SectionLabel>How it works</SectionLabel>
            <h2 className="mt-3 text-3xl font-bold tracking-tight md:text-4xl">
              Upload, process, export
            </h2>
            <p className="mt-4 text-pretty text-muted-foreground">
              Three steps from a photo on your phone to clean rows in your database.
            </p>
          </div>
          <div className="relative grid gap-5 md:grid-cols-3">
            {/* connector line */}
            <div className="pointer-events-none absolute inset-x-[16%] top-[3.25rem] hidden h-px bg-gradient-to-r from-transparent via-border to-transparent md:block" />
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

      {/* CTA */}
      <section id="pricing" className="px-5 py-24 md:py-28">
        <div className="relative mx-auto max-w-4xl overflow-hidden rounded-3xl border border-primary/20 bg-primary/[0.06] px-6 py-16 text-center">
          <div className="grid-mask pointer-events-none absolute inset-0 opacity-30">
            <div className="receipt-grid absolute -inset-1" />
          </div>
          <div className="glow-orb pointer-events-none absolute left-1/2 top-full size-[500px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary/15 blur-[130px]" />
          <div className="relative">
            <h2 className="text-balance text-3xl font-bold tracking-tight md:text-4xl">
              Start extracting data today
            </h2>
            <p className="mx-auto mt-4 max-w-md text-pretty text-muted-foreground">
              Free local development. Bring your own provider keys and storage — no lock-in.
            </p>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <Button asChild size="lg">
                <Link href="/sign-in">
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

      {/* Footer */}
      <footer className="border-t border-border px-5 py-10">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 text-sm text-muted-foreground md:flex-row">
          <Brand />
          <span className="font-mono text-xs">Next.js · Clerk · Effect · AI SDK · Drizzle</span>
          <span className="flex items-center gap-1.5">
            <Check className="size-4 text-primary" /> Built for real OCR
          </span>
        </div>
      </footer>
    </main>
  );
}
