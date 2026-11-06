import { buttonVariants } from "@receipt-ocr/ui/components/button";
import { cn } from "@receipt-ocr/ui/lib/utils";
import { ArrowRight, Check } from "lucide-react";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import { ContactButton } from "@/components/contact-button";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { SupportWidget } from "@/components/support-widget";
import { comingSoon, faqs, freePlan, specs } from "../../content";
import { dataStops, navLinks, reassurance, steps } from "./copy";
import { CheckFragment, ExportFragment, UploadFragment } from "./fragments";
import { ScanReceipt } from "./scan-receipt";
import "./h.css";

const sans = Geist({ subsets: ["latin"], variable: "--font-h-sans", display: "swap" });
const mono = Geist_Mono({ subsets: ["latin"], variable: "--font-h-mono", display: "swap" });

const container = "mx-auto w-full max-w-6xl px-4 sm:px-5";
const h2 =
  "text-balance text-[2.1rem] font-semibold leading-[1.06] tracking-[-0.032em] sm:text-5xl";

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex items-center gap-3 font-mono text-xs text-muted-foreground">
      <span aria-hidden className="h-px w-5 bg-primary shadow-[0_0_8px_var(--primary)]" />
      {children}
    </p>
  );
}

function PrimaryCta({ className }: { className?: string }) {
  return (
    <Link
      className={cn(buttonVariants({ size: "lg" }), "font-semibold", className)}
      href="/sign-up"
    >
      Get started free <ArrowRight aria-hidden className="size-4" />
    </Link>
  );
}

const fragments = [UploadFragment, CheckFragment, ExportFragment];

const faqJsonLd = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: faqs.map((faq) => ({
    "@type": "Question",
    name: faq.q,
    acceptedAnswer: { "@type": "Answer", text: faq.a },
  })),
};

export function LandingH() {
  return (
    <div className={cn(sans.variable, mono.variable, "h-root min-h-screen antialiased")}>
      <SiteHeader links={navLinks} />
      <main className="overflow-x-clip">
        {/* ---------- Hero ---------- */}
        <section className="h-hero pb-16 pt-28 sm:pt-32 lg:pb-24 lg:pt-36">
          <div
            className={cn(
              container,
              "grid items-center gap-12 lg:grid-cols-[minmax(0,1fr)_452px] lg:gap-20",
            )}
          >
            <div className="h-reveal">
              <p className="font-mono text-xs text-muted-foreground">
                Receipt OCR for freelancers and small businesses
              </p>
              <h1 className="mt-6 text-balance text-[3rem] font-semibold leading-[0.98] tracking-[-0.045em] sm:text-7xl lg:text-[5.25rem]">
                Stop typing in receipts.
              </h1>
              <p className="mt-7 max-w-[34rem] text-pretty text-[17px] leading-[1.65] text-muted-foreground sm:text-lg">
                Take a photo. receiptOCR reads the{" "}
                <span className="text-foreground">
                  merchant, date, every line item, tax and total
                </span>
                , flags anything it isn&apos;t sure about, and gives you a CSV for your books.
              </p>
              <div className="mt-8 flex flex-col gap-3 sm:mt-10 sm:flex-row sm:items-center">
                <PrimaryCta className="w-full sm:w-auto" />
                <a
                  className={cn(
                    buttonVariants({ size: "lg", variant: "ghost" }),
                    "w-full text-foreground sm:w-auto",
                  )}
                  href="#how"
                >
                  See how it works
                </a>
              </div>
              <p className="mt-5 font-mono text-xs text-muted-foreground">{reassurance}</p>
            </div>

            <div className="h-reveal h-reveal-2 relative mx-auto w-full max-w-[452px] px-0 py-2 sm:px-10 sm:py-10">
              <span aria-hidden className="h-corner -left-1.5 -top-1.5 max-sm:hidden" />
              <span aria-hidden className="h-corner -right-1.5 -top-1.5 max-sm:hidden" />
              <span aria-hidden className="h-corner -bottom-1.5 -left-1.5 max-sm:hidden" />
              <span aria-hidden className="h-corner -bottom-1.5 -right-1.5 max-sm:hidden" />
              <ScanReceipt />
            </div>
          </div>
        </section>

        {/* ---------- How it works ---------- */}
        <section className="scroll-mt-20 py-16 lg:py-24" id="how">
          <div className={container}>
            <div className="h-rule" />
            <div className="mt-12 max-w-4xl">
              <SectionLabel>How it works</SectionLabel>
              <h2 className={cn(h2, "mt-6")}>
                You take the photo.{" "}
                <span className="text-muted-foreground">It does the typing.</span>
              </h2>
            </div>

            <ol className="mt-16 flex flex-col gap-20 lg:mt-24 lg:gap-24">
              {steps.map((step, i) => {
                const Fragment = fragments[i];
                return (
                  <li
                    className="grid gap-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-20"
                    key={step.index}
                  >
                    <div className="lg:pt-6">
                      <p className="font-mono text-xs text-primary">{step.index}</p>
                      <h3 className="mt-4 text-2xl font-semibold tracking-[-0.02em]">
                        {step.title}
                      </h3>
                      <p className="mt-4 max-w-md text-[15px] leading-7 text-muted-foreground">
                        {step.body}
                      </p>
                      <p className="mt-5 font-mono text-xs text-muted-foreground">{step.note}</p>
                    </div>
                    <Fragment />
                  </li>
                );
              })}
            </ol>
          </div>
        </section>

        {/* ---------- Your data ---------- */}
        <section className="scroll-mt-20 py-16 lg:py-24" id="data">
          <div className={container}>
            <div className="h-rule" />
            <div className="mt-12 max-w-4xl">
              <SectionLabel>Your data</SectionLabel>
              <h2 className={cn(h2, "mt-6")}>
                Where your receipt goes.{" "}
                <span className="text-muted-foreground">Every stop, named.</span>
              </h2>
            </div>

            <ol className="relative mt-16 grid gap-10 pl-8 md:grid-cols-4 md:gap-8 md:pl-0 md:pt-0">
              <span aria-hidden className="h-wire" />
              {dataStops.map((stop, i) => {
                const ai = stop.name === "Google Gemini";
                return (
                  <li className="relative md:pt-10" key={stop.name}>
                    <span
                      aria-hidden
                      className={cn(
                        "absolute -left-8 top-1 size-[9px] rounded-full bg-background ring-1 ring-white/30 md:left-0 md:top-0",
                        ai && "bg-primary ring-primary shadow-[0_0_14px_var(--primary)]",
                      )}
                    />
                    <p className="font-mono text-[11px] text-muted-foreground">Stop {i + 1}</p>
                    <h3 className="mt-2 text-base font-semibold">{stop.name}</h3>
                    <p className="mt-2 max-w-[17rem] text-sm leading-6 text-muted-foreground">
                      {stop.body}
                    </p>
                  </li>
                );
              })}
            </ol>

            <div className="mt-20 grid gap-10 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-20">
              <div className="lg:sticky lg:top-28 lg:self-start">
                <h3 className="text-2xl font-semibold tracking-[-0.02em]">
                  The spec, as enforced.
                </h3>
                <p className="mt-4 max-w-md text-[15px] leading-7 text-muted-foreground">
                  Every limit here is checked in code, not in a footnote. If it changes, this list
                  changes with it.
                </p>
              </div>
              <dl className="h-panel divide-y divide-(--h-hairline) px-5">
                {specs.map((spec) => (
                  <div
                    className="flex flex-wrap items-baseline gap-x-4 gap-y-1 py-4"
                    key={spec.label}
                  >
                    <dt className="text-sm">{spec.label}</dt>
                    <span aria-hidden className="h-leader max-sm:hidden" />
                    <dd className="font-mono text-[13px] max-sm:w-full sm:text-right">
                      {spec.value}
                      <span className="mt-1 block font-sans text-xs text-muted-foreground sm:text-right">
                        {spec.note}
                      </span>
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          </div>
        </section>

        {/* ---------- Pricing ---------- */}
        <section className="scroll-mt-20 py-16 lg:py-24" id="pricing">
          <div className={container}>
            <div className="h-rule" />
            <div className="mt-12 max-w-4xl">
              <SectionLabel>Pricing</SectionLabel>
              <h2 className={cn(h2, "mt-6")}>
                One plan, and it&apos;s free.{" "}
                <span className="text-muted-foreground">No card, no time limit.</span>
              </h2>
            </div>

            <div className="h-panel mt-14 grid overflow-hidden lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)_minmax(0,1fr)]">
              <div className="flex flex-col p-7 sm:p-9">
                <p className="font-mono text-xs text-muted-foreground">{freePlan.name}</p>
                <p className="mt-5 flex items-baseline gap-3">
                  <span className="text-7xl font-semibold tracking-[-0.05em] sm:text-8xl">
                    {freePlan.price}
                  </span>
                  <span className="font-mono text-xs text-muted-foreground">/ month</span>
                </p>
                <p className="mt-4 text-[15px] leading-7 text-muted-foreground">
                  {freePlan.summary}
                </p>
                <PrimaryCta className="mt-8 w-full lg:mt-auto" />
              </div>

              <div className="border-t border-(--h-hairline) p-7 sm:p-9 lg:border-l lg:border-t-0">
                <p className="font-mono text-xs text-muted-foreground">Included</p>
                <ul className="mt-5 flex flex-col gap-3.5">
                  {freePlan.includes.map((line) => (
                    <li className="flex gap-3 text-[15px] leading-6" key={line}>
                      <Check aria-hidden className="mt-1 size-4 shrink-0 text-primary" />
                      {line}
                    </li>
                  ))}
                </ul>
              </div>

              <div className="border-t border-(--h-hairline) bg-white/[0.015] p-7 sm:p-9 lg:border-l lg:border-t-0">
                <p className="font-mono text-xs text-muted-foreground">Not built yet</p>
                <ul className="mt-5 flex flex-col gap-5">
                  {comingSoon.map((item) => (
                    <li key={item.title}>
                      <p className="flex items-center gap-2.5 text-[15px] font-medium">
                        {item.title}
                        <span className="rounded-full px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground ring-1 ring-white/15">
                          Coming
                        </span>
                      </p>
                      <p className="mt-1.5 text-sm leading-6 text-muted-foreground">{item.desc}</p>
                    </li>
                  ))}
                </ul>
                <ContactButton className="mt-8 w-full" size="lg" topic="use-case" variant="outline">
                  Need more now? Contact us
                </ContactButton>
              </div>
            </div>
          </div>
        </section>

        {/* ---------- FAQ ---------- */}
        <section className="scroll-mt-20 py-16 lg:py-24" id="faq">
          <div className={container}>
            <div className="h-rule" />
            <div className="mt-12 grid gap-12 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-20">
              <div>
                <SectionLabel>FAQ</SectionLabel>
                <h2 className={cn(h2, "mt-6")}>
                  Plain answers. <span className="text-muted-foreground">No fine print.</span>
                </h2>
              </div>
              <div className="h-faq divide-y divide-(--h-hairline) border-y border-(--h-hairline)">
                <script
                  dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
                  type="application/ld+json"
                />
                {faqs.map((faq) => (
                  <details className="group" key={faq.q}>
                    <summary className="flex min-h-16 cursor-pointer list-none items-center -mx-3 justify-between gap-6 rounded-lg px-3 py-4 text-[16px] font-medium transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                      {faq.q}
                      <span
                        aria-hidden
                        className="relative size-3 shrink-0 text-muted-foreground before:absolute before:inset-x-0 before:top-1/2 before:h-px before:bg-current after:absolute after:inset-y-0 after:left-1/2 after:w-px after:bg-current after:transition-transform group-open:text-primary group-open:after:scale-y-0"
                      />
                    </summary>
                    <p className="max-w-xl pb-6 pr-8 text-[15px] leading-7 text-muted-foreground">
                      {faq.a}
                    </p>
                  </details>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* ---------- Final CTA ---------- */}
        <section className="relative pb-28 pt-12 lg:pb-40">
          <div className={cn(container, "relative")}>
            <div aria-hidden className="h-cta-line" />
            <div className="relative pt-24 text-center lg:pt-32">
              <h2 className="mx-auto max-w-3xl text-balance text-[2.5rem] font-semibold leading-[1.02] tracking-[-0.04em] sm:text-6xl">
                Start with the receipt in your pocket.
              </h2>
              <p className="mt-6 font-mono text-xs text-muted-foreground">{reassurance}</p>
              <div className="mt-10 flex flex-col justify-center gap-3 sm:flex-row">
                <PrimaryCta className="w-full sm:w-auto" />
                <Link
                  className={cn(
                    buttonVariants({ size: "lg", variant: "outline" }),
                    "w-full sm:w-auto",
                  )}
                  href="/sign-in"
                >
                  Sign in
                </Link>
              </div>
            </div>
          </div>
        </section>
      </main>
      <SiteFooter />
      <SupportWidget />
    </div>
  );
}
