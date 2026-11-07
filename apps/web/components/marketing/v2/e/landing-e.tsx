import { buttonVariants } from "@receipt-ocr/ui/components/button";
import { cn } from "@receipt-ocr/ui/lib/utils";
import { ArrowRight, Check, Plus } from "lucide-react";
import { Caveat, Geist, Geist_Mono, Space_Mono } from "next/font/google";
import Link from "next/link";
import { ContactButton } from "@/components/contact-button";
import { SupportWidget } from "@/components/support-widget";
import { comingSoon, faqs, freePlan, specs } from "../../content";
import { ExportFragment, HistoryFragment, ReviewFragment } from "./fragments";
import { HeroDemo } from "./hero-demo";
import "./e.css";

// Reuses the app's font variable names so every font-sans / font-mono utility inside the
// wrapper resolves to Geist without editing the shared theme.
const sans = Geist({ subsets: ["latin"], variable: "--font-dm-sans", display: "swap" });
const mono = Geist_Mono({ subsets: ["latin"], variable: "--font-jetbrains-mono", display: "swap" });
const paper = Space_Mono({
  subsets: ["latin"],
  weight: ["400", "700"],
  variable: "--e-font-paper",
  display: "swap",
});
const hand = Caveat({
  subsets: ["latin"],
  weight: "600",
  variable: "--e-font-hand",
  display: "swap",
});

const container = "mx-auto w-full max-w-[76rem] px-4 sm:px-6 lg:px-8";
const ctaPrimary = cn(buttonVariants({ size: "lg" }), "shadow-none hover:shadow-none");
const ctaSecondary = buttonVariants({ size: "lg", variant: "outline" });

const nav = [
  { label: "How it works", href: "#how" },
  { label: "Privacy", href: "#data" },
  { label: "Pricing", href: "#pricing" },
  { label: "FAQ", href: "#faq" },
];

function Wordmark() {
  return (
    <span className="flex items-center gap-2 font-semibold tracking-tight">
      <svg aria-hidden="true" className="size-6 text-primary" fill="none" viewBox="0 0 24 24">
        <path
          d="M5 3h14v17.5l-2.33-1.5-2.34 1.5L12 19l-2.33 1.5L7.33 19 5 20.5V3Z"
          fill="currentColor"
        />
        <path
          d="M8.5 8h7M8.5 11.5h7M8.5 15h4"
          stroke="var(--card)"
          strokeLinecap="round"
          strokeWidth="1.6"
        />
      </svg>
      ReceiptOCR
    </span>
  );
}

function Header() {
  return (
    <header className="sticky top-0 z-40 border-b border-border/70 bg-background/85 backdrop-blur-md">
      <div className={cn(container, "flex h-16 items-center justify-between gap-4")}>
        <Link
          aria-label="ReceiptOCR home"
          className="inline-flex min-h-11 items-center rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
          href="/landing-e"
        >
          <Wordmark />
        </Link>
        <nav aria-label="Sections" className="hidden items-center gap-1 md:flex">
          {nav.map((item) => (
            <a
              className={buttonVariants({ variant: "ghost", size: "sm" })}
              href={item.href}
              key={item.href}
            >
              {item.label}
            </a>
          ))}
        </nav>
        <div className="flex items-center gap-1 sm:gap-2">
          <Link className={buttonVariants({ variant: "ghost", size: "sm" })} href="/sign-in">
            Sign in
          </Link>
          <Link
            className={cn(buttonVariants({ size: "sm" }), "shadow-none hover:shadow-none")}
            href="/sign-up"
          >
            Start free
          </Link>
        </div>
      </div>
    </header>
  );
}

function Hero() {
  return (
    <section aria-labelledby="hero-title" className="relative overflow-hidden">
      <div aria-hidden="true" className="e-dots pointer-events-none absolute inset-0" />
      <div
        className={cn(
          container,
          "relative grid gap-10 pt-10 pb-16 lg:grid-cols-[minmax(0,28rem)_minmax(0,1fr)] lg:items-center lg:gap-14 lg:pt-10 lg:pb-20",
        )}
      >
        <div>
          <h1
            className="text-[2.5rem] leading-[1.03] font-semibold tracking-[-0.035em] sm:text-6xl lg:text-[3.3rem]"
            id="hero-title"
          >
            <span className="block text-balance">Receipt photos in.</span>
            <span className="block text-balance">Spreadsheet rows out.</span>
          </h1>
          <p className="mt-5 max-w-md text-base leading-relaxed text-pretty text-muted-foreground sm:text-lg">
            ReceiptOCR scans the merchant, date, line items, tax and total, points out anything it
            isn&apos;t sure of, and adds each receipt to a CSV.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Link className={cn(ctaPrimary, "w-full sm:w-auto")} href="/sign-up">
              Start free <ArrowRight aria-hidden="true" className="size-4" />
            </Link>
            <a className={cn(ctaSecondary, "hidden sm:inline-flex")} href="#how">
              See how it works
            </a>
          </div>
          <p className="mt-5 text-sm text-muted-foreground">
            <span className="font-medium text-foreground">Free</span> · {freePlan.receiptsPerDay}{" "}
            receipts a day · no card needed
          </p>
        </div>
        <HeroDemo />
      </div>
    </section>
  );
}

const steps = [
  {
    id: "review",
    n: "01",
    title: "It tells you what to check.",
    body: "Every receipt gets a confidence score, and so does every line item. Anything hard to read is highlighted, and you can fix the merchant, date, category or amounts before it goes anywhere.",
    caption: "The review screen: fields you can edit, with a hard-to-read line item highlighted.",
    fragment: <ReviewFragment />,
  },
  {
    id: "history",
    n: "02",
    title: "Every receipt, easy to find again.",
    body: "Search by merchant or file name, filter by category, or pull up only the receipts that still need a look.",
    caption: "History: searching for “hart” finds three receipts.",
    fragment: <HistoryFragment />,
  },
  {
    id: "export",
    n: "03",
    title: "One file for your accountant.",
    body: "Download a CSV of one receipt or your whole workspace, filtered or not. Copy any receipt as JSON if you need the raw data. No export fees.",
    caption: "Export: a CSV with one row per receipt, and a receipt copied as JSON.",
    fragment: <ExportFragment />,
  },
];

function How() {
  return (
    <section
      aria-labelledby="how-title"
      className="scroll-mt-16 border-t border-border bg-card"
      id="how"
    >
      <div className={cn(container, "py-20 sm:py-28")}>
        <h2
          className="max-w-2xl text-3xl font-semibold tracking-[-0.025em] text-balance sm:text-4xl"
          id="how-title"
        >
          After it scans, you stay in control.
        </h2>
        <p className="mt-4 max-w-xl text-muted-foreground">
          The demo above is the first step. Here is the rest of the app.
        </p>
        <div className="mt-14 flex flex-col gap-20 sm:gap-24">
          {steps.map((step, i) => (
            <figure
              className={cn(
                "grid items-center gap-8 lg:gap-16",
                i % 2 === 1
                  ? "lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]"
                  : "lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]",
              )}
              id={step.id}
              key={step.id}
            >
              <div className={cn(i % 2 === 1 && "lg:order-2")}>
                <p className="font-mono text-sm text-primary">{step.n}</p>
                <h3 className="mt-3 text-2xl font-semibold tracking-[-0.02em]">{step.title}</h3>
                <p className="mt-3 leading-relaxed text-muted-foreground">{step.body}</p>
              </div>
              {step.fragment}
              <figcaption className="sr-only">{step.caption}</figcaption>
            </figure>
          ))}
        </div>
      </div>
    </section>
  );
}

const flow = [
  {
    title: "Your device",
    body: "You choose the photos. PNG, JPG or HEIC, up to 10 MB each.",
  },
  {
    title: "Private storage",
    body: "The image is kept in storage only your workspace can open.",
  },
  {
    title: "Google Gemini",
    body: "Google's Gemini AI scans the image and returns the fields.",
  },
  {
    title: "Your workspace",
    body: "Only you and people you invite can see it. Delete a receipt, or your account, from Settings.",
  },
];

function Data() {
  return (
    <section aria-labelledby="data-title" className="scroll-mt-16 border-t border-border" id="data">
      <div className={cn(container, "py-20 sm:py-28")}>
        <div className="grid gap-6 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)] lg:gap-16">
          <div>
            <h2
              className="text-3xl font-semibold tracking-[-0.025em] text-balance sm:text-4xl"
              id="data-title"
            >
              Where your receipts go.
            </h2>
            <p className="mt-4 leading-relaxed text-muted-foreground">
              Four stops, in plain words. The demo on this page is different: it never leaves your
              browser.
            </p>
          </div>
          <ol className="grid gap-px overflow-hidden rounded-2xl border border-border bg-border sm:grid-cols-2">
            {flow.map((stop, i) => (
              <li className="bg-card p-6" key={stop.title}>
                <p className="font-mono text-xs text-muted-foreground">Stop {i + 1}</p>
                <p className="mt-2 font-semibold">{stop.title}</p>
                <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{stop.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}

function Pricing() {
  const factRows = specs.filter((s) => s.label !== "Free plan");
  return (
    <section
      aria-labelledby="pricing-title"
      className="scroll-mt-16 border-t border-border bg-card"
      id="pricing"
    >
      <div className={cn(container, "py-20 sm:py-28")}>
        <h2 className="text-3xl font-semibold tracking-[-0.025em] sm:text-4xl" id="pricing-title">
          One plan for now, and it&apos;s free.
        </h2>
        <div className="mt-12 grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="rounded-2xl border border-border bg-background p-6 sm:p-8">
            <p className="text-sm font-medium text-muted-foreground">{freePlan.name}</p>
            <p className="mt-2 flex items-baseline gap-2">
              <span className="text-5xl font-semibold tracking-tight">{freePlan.price}</span>
              <span className="text-muted-foreground">no card, no time limit</span>
            </p>
            <ul className="mt-6 grid gap-2.5 text-sm">
              {freePlan.includes.map((line) => (
                <li className="flex gap-2.5" key={line}>
                  <Check aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-primary" />
                  {line}
                </li>
              ))}
            </ul>
            <Link className={cn(ctaPrimary, "mt-8 w-full")} href="/sign-up">
              Create a free account
            </Link>
          </div>
          <div className="flex flex-col gap-6">
            <dl className="divide-y divide-border rounded-2xl border border-border">
              {factRows.map((row) => (
                <div
                  className="grid grid-cols-[7rem_minmax(0,1fr)] gap-4 px-5 py-3.5 text-sm sm:grid-cols-[9rem_minmax(0,1fr)]"
                  key={row.label}
                >
                  <dt className="text-muted-foreground">{row.label}</dt>
                  <dd>
                    <span className="font-mono text-[13px]">{row.value}</span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">{row.note}</span>
                  </dd>
                </div>
              ))}
            </dl>
            <div className="rounded-2xl border border-dashed border-input/50 p-5">
              <p className="text-sm font-medium">Coming</p>
              <ul className="mt-3 grid gap-3 text-sm">
                {comingSoon.map((item) => (
                  <li key={item.title}>
                    <span className="font-medium">{item.title}.</span>{" "}
                    <span className="text-muted-foreground">{item.desc}</span>
                  </li>
                ))}
              </ul>
              <ContactButton className="mt-4" size="sm" topic="use-case" variant="outline">
                Contact us
              </ContactButton>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function Faq() {
  return (
    <section aria-labelledby="faq-title" className="scroll-mt-16 border-t border-border" id="faq">
      <div
        className={cn(
          container,
          "grid gap-8 py-20 sm:py-28 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)] lg:gap-16",
        )}
      >
        <h2 className="text-3xl font-semibold tracking-[-0.025em] sm:text-4xl" id="faq-title">
          Questions
        </h2>
        <div className="divide-y divide-border border-y border-border">
          {faqs.map((item) => (
            <details className="group" key={item.q}>
              <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 rounded-md py-4 font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
                {item.q}
                <Plus
                  aria-hidden="true"
                  className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-45 motion-reduce:transition-none"
                />
              </summary>
              <p className="max-w-2xl pb-5 leading-relaxed text-muted-foreground">{item.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

function FinalCta() {
  return (
    <section
      aria-labelledby="cta-title"
      className="border-t border-border bg-foreground text-background"
    >
      <div
        className={cn(
          container,
          "flex flex-col items-start gap-8 py-20 sm:py-24 lg:flex-row lg:items-end lg:justify-between",
        )}
      >
        <div>
          <h2
            className="max-w-xl text-3xl font-semibold tracking-[-0.025em] text-balance sm:text-5xl"
            id="cta-title"
          >
            Start with the receipt in your pocket.
          </h2>
          <p className="mt-4 text-background/70">
            Free · {freePlan.receiptsPerDay} receipts a day · no card needed
          </p>
        </div>
        <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
          <Link
            className={cn(
              buttonVariants({ size: "lg" }),
              "w-full bg-background text-foreground shadow-none hover:bg-background/90 hover:shadow-none focus-visible:ring-background focus-visible:ring-offset-foreground sm:w-auto",
            )}
            href="/sign-up"
          >
            Start free <ArrowRight aria-hidden="true" className="size-4" />
          </Link>
          <Link
            className={cn(
              buttonVariants({ size: "lg", variant: "ghost" }),
              "w-full text-background/80 hover:bg-background/10 hover:text-background focus-visible:ring-background focus-visible:ring-offset-foreground sm:w-auto",
            )}
            href="/sign-in"
          >
            Sign in
          </Link>
        </div>
      </div>
    </section>
  );
}

const footerLinks = [
  { label: "Privacy", href: "/privacy" },
  { label: "Terms", href: "/terms" },
  { label: "Sign in", href: "/sign-in" },
  { label: "Create an account", href: "/sign-up" },
];

function Footer() {
  return (
    <footer className="bg-foreground text-background/70">
      <div
        className={cn(
          container,
          "flex flex-col gap-6 border-t border-background/15 py-10 text-sm sm:flex-row sm:items-center sm:justify-between",
        )}
      >
        <div className="text-background">
          <Wordmark />
        </div>
        <ul className="flex flex-wrap gap-x-1 gap-y-1">
          {footerLinks.map((link) => (
            <li key={link.href}>
              <Link
                className="inline-flex min-h-11 items-center rounded-md px-2.5 outline-none hover:text-background focus-visible:ring-2 focus-visible:ring-background"
                href={link.href}
              >
                {link.label}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </footer>
  );
}

export function LandingE() {
  return (
    <div
      className={cn(
        "landing-e min-h-screen font-sans antialiased",
        sans.variable,
        mono.variable,
        paper.variable,
        hand.variable,
      )}
    >
      <a
        className="sr-only z-50 rounded-md bg-card px-4 py-2 focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:ring-2 focus:ring-ring"
        href="#main"
      >
        Skip to content
      </a>
      <Header />
      <main id="main">
        <Hero />
        <How />
        <Data />
        <Pricing />
        <Faq />
        <FinalCta />
      </main>
      <Footer />
      <SupportWidget />
    </div>
  );
}
