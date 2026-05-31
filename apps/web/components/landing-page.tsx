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
import { Brand } from "./brand";

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

const receiptCards = [
  {
    merchant: "Whole Foods",
    total: "$67.43",
    lines: [
      ["Bananas", "$2.49"],
      ["Almond Milk", "$4.99"],
      ["Bread", "$5.49"],
    ],
    className: "left-[5%] top-[22%] [--r:-6deg]",
  },
  {
    merchant: "Starbucks",
    total: "$12.75",
    lines: [
      ["Oat Latte", "$6.25"],
      ["Muffin", "$3.95"],
      ["Water", "$2.55"],
    ],
    className: "right-[8%] top-[18%] [--r:4deg] [animation-delay:1s]",
  },
  {
    merchant: "Shell Gas",
    total: "$52.18",
    lines: [
      ["Unleaded", "$48.36"],
      ["Car Wash", "$3.82"],
      ["Snack", "$1.00"],
    ],
    className: "right-[5%] top-[61%] [--r:-3deg] [animation-delay:2s]",
  },
];

function FloatingReceiptCard({
  card,
}: {
  card: (typeof receiptCards)[number];
}) {
  return (
    <div
      className={`floating-receipt absolute hidden h-[178px] w-[210px] flex-col rounded-xl border border-white/10 bg-card/80 p-4 font-mono text-[11px] opacity-85 shadow-2xl backdrop-blur-xl lg:flex ${card.className}`}
    >
      <div className="mb-3 text-xs font-semibold text-foreground">{card.merchant}</div>
      <div className="flex flex-1 flex-col gap-1 text-muted-foreground">
        {card.lines.map(([name, price]) => (
          <div className="flex justify-between" key={name}>
            <span>{name}</span>
            <span>{price}</span>
          </div>
        ))}
      </div>
      <div className="mt-2 flex justify-between border-t border-dashed border-white/10 pt-2 font-semibold text-primary">
        <span>Total</span>
        <span>{card.total}</span>
      </div>
    </div>
  );
}

export function LandingPage() {
  return (
    <main className="min-h-screen overflow-hidden bg-background text-foreground">
      <header className="fixed inset-x-0 top-0 z-40 border-b border-transparent bg-background/70 px-5 backdrop-blur-xl md:px-10">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between">
          <Brand />
          <nav className="hidden items-center gap-7 text-sm text-muted-foreground md:flex">
            <a href="#features" className="hover:text-foreground">
              Features
            </a>
            <a href="#how" className="hover:text-foreground">
              How it works
            </a>
            <a href="#pricing" className="hover:text-foreground">
              Pricing
            </a>
            <Button asChild variant="outline" size="sm">
              <Link href="/sign-in">Sign in</Link>
            </Button>
          </nav>
        </div>
      </header>

      <section className="relative flex min-h-screen items-center justify-center px-5 py-28 text-center">
        <div className="grid-mask absolute inset-0 opacity-40">
          <div className="receipt-grid absolute -inset-1" />
        </div>
        <div className="glow-orb absolute left-1/2 top-[38%] size-[700px] rounded-full bg-primary/15 blur-[150px]" />
        <div className="glow-orb absolute left-[25%] top-[56%] size-[400px] rounded-full bg-sky-400/10 blur-[120px]" />
        <div className="glow-orb absolute left-[78%] top-[60%] size-[350px] rounded-full bg-fuchsia-400/10 blur-[110px]" />
        {receiptCards.map((card) => (
          <FloatingReceiptCard card={card} key={card.merchant} />
        ))}

        <div className="relative z-10 mx-auto max-w-3xl animate-fade-up">
          <div className="mb-8 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-4 py-1.5 font-mono text-xs text-muted-foreground">
            <span className="size-1.5 rounded-full bg-primary shadow-[0_0_10px_var(--primary)]" />
            v0.1 · AI SDK · Effect TS
          </div>
          <h1 className="text-5xl font-bold leading-none tracking-tight md:text-7xl">
            <span className="block">Receipts to</span>
            <span className="block bg-gradient-to-r from-primary via-sky-300 to-violet-300 bg-clip-text text-transparent">
              structured data
            </span>
          </h1>
          <p className="mx-auto mt-6 max-w-xl text-base leading-8 text-muted-foreground md:text-lg">
            Extract line items, totals, categories, and confidence from receipt images with
            Gemini OCR, Postgres history, and S3-compatible storage.
          </p>
          <div className="mt-10 flex flex-wrap justify-center gap-3">
            <Button asChild size="lg">
              <Link href="/sign-in">
                Get started free <ArrowRight className="size-4" />
              </Link>
            </Button>
            <Button variant="outline" size="lg">
              pnpm dev
            </Button>
          </div>
        </div>
      </section>

      <section className="border-y border-border bg-secondary/30 px-5 py-10">
        <div className="mx-auto grid max-w-5xl grid-cols-2 gap-8 text-center md:grid-cols-4">
          {[
            ["2.4M+", "Receipts processed"],
            ["98%", "Target accuracy"],
            ["1.2s", "Fast MVP path"],
            ["5", "Provider-ready layers"],
          ].map(([value, label]) => (
            <div key={label}>
              <div className="font-mono text-3xl font-bold">{value}</div>
              <div className="mt-1 text-sm text-muted-foreground">{label}</div>
            </div>
          ))}
        </div>
      </section>

      <section id="features" className="px-5 py-24">
        <div className="mx-auto max-w-5xl">
          <div className="mb-12 text-center">
            <p className="font-mono text-xs uppercase tracking-[0.18em] text-primary">Features</p>
            <h2 className="mt-3 text-4xl font-bold tracking-tight">Everything for the MVP</h2>
            <p className="mt-3 text-muted-foreground">A complete receipt pipeline from upload to structured records.</p>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            {features.map((feature) => {
              const Icon = feature.icon;
              return (
                <Card className="group relative overflow-hidden p-6 transition hover:-translate-y-1 hover:border-primary/40" key={feature.title}>
                  <div className="absolute -right-12 -top-12 size-32 rounded-full bg-primary/0 blur-3xl transition group-hover:bg-primary/10" />
                  <div className="mb-4 flex size-10 items-center justify-center rounded-lg border border-primary/20 bg-primary/10 text-primary">
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

      <section id="how" className="px-5 py-24">
        <div className="mx-auto max-w-5xl">
          <div className="mb-12 text-center">
            <p className="font-mono text-xs uppercase tracking-[0.18em] text-primary">How it works</p>
            <h2 className="mt-3 text-4xl font-bold tracking-tight">Upload, process, export</h2>
          </div>
          <div className="grid gap-5 md:grid-cols-3">
            {["Upload a receipt image", "Gemini extracts typed JSON", "Review history and export"].map((step, index) => (
              <Card className="p-6 text-center" key={step}>
                <div className="mx-auto mb-5 flex size-14 items-center justify-center rounded-xl border border-border bg-secondary font-mono text-lg font-bold text-primary">
                  {String(index + 1).padStart(2, "0")}
                </div>
                <h3 className="font-semibold">{step}</h3>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  {index === 0
                    ? "Server-mediated upload keeps storage credentials private."
                    : index === 1
                      ? "AI SDK keeps provider switching realistic later."
                      : "Data lands in Postgres with statuses ready for background jobs."}
                </p>
              </Card>
            ))}
          </div>
        </div>
      </section>

      <section id="pricing" className="px-5 py-24">
        <div className="mx-auto max-w-3xl rounded-2xl border border-primary/20 bg-primary/5 p-10 text-center">
          <h2 className="text-3xl font-bold tracking-tight">Start extracting data today</h2>
          <p className="mt-3 text-muted-foreground">Free local development. Bring your own provider keys and storage.</p>
          <div className="mt-7 flex justify-center">
            <Button asChild>
              <Link href="/sign-in">
                Continue <ArrowRight className="size-4" />
              </Link>
            </Button>
          </div>
        </div>
      </section>

      <footer className="border-t border-border px-5 py-10">
        <div className="mx-auto flex max-w-6xl flex-col justify-between gap-4 text-sm text-muted-foreground md:flex-row">
          <Brand />
          <span className="font-mono">Next.js · Clerk · Effect · AI SDK · Drizzle</span>
          <span className="flex items-center gap-1">
            <Check className="size-4 text-primary" /> Built for real OCR
          </span>
        </div>
      </footer>
    </main>
  );
}
