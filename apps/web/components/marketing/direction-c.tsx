import { buttonVariants } from "@receipt-ocr/ui/components/button";
import { cn } from "@receipt-ocr/ui/lib/utils";
import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { ContactButton } from "@/components/contact-button";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { SupportWidget } from "@/components/support-widget";
import { comingSoon, freePlan, specs } from "./content";
import { FaqList } from "./faq";
import { OutputTabs } from "./output-tabs";
import { CsvSheet, ExtractedPanel, JsonBlock, ReceiptSlip } from "./previews";
import { BackdropGrid, Eyebrow, SignUpCta } from "./primitives";
import "./marketing.css";

const pipeline = [
  {
    step: "01",
    verb: "Upload",
    detail: "IMG_4021.HEIC",
    note: "Phone camera or file, up to 20 at once",
  },
  {
    step: "02",
    verb: "Scan",
    detail: "merchant · items · tax · total",
    note: "Google's Gemini model scans the image",
  },
  { step: "03", verb: "Check", detail: "96% confidence", note: "Fix any field that's off" },
  { step: "04", verb: "Export", detail: "receipts.csv", note: "Or copy one receipt as JSON" },
];

const dataFlow = [
  ["Your device", "You take a photo or pick a file on your phone or computer."],
  ["Private storage", "The image is stored for your workspace only."],
  ["Google Gemini", "Google's AI scans the image and returns the fields."],
  ["Your workspace", "You review, edit and export. Delete whenever you like."],
];

function Leader({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-3">
      <dt className="shrink-0">{label}</dt>
      <span aria-hidden className="dot-leader h-3 min-w-6 flex-1" />
      <dd className="shrink-0 text-right">{value}</dd>
    </div>
  );
}

export function DirectionC() {
  return (
    <>
      <SiteHeader />
      <main className="overflow-x-clip bg-background text-foreground">
        <section className="relative px-5 pb-20 pt-32 md:pt-40">
          <BackdropGrid />
          <div className="relative mx-auto grid max-w-6xl gap-14 lg:grid-cols-[1fr_1fr] lg:items-start">
            <div className="reveal-up lg:pt-10">
              <p className="inline-flex items-center gap-2 rounded-full bg-foreground/[0.04] px-3 py-1.5 font-mono text-xs text-muted-foreground ring-1 ring-border">
                <span
                  aria-hidden
                  className="size-1.5 rounded-full bg-primary shadow-[0_0_10px_var(--primary)]"
                />
                Early access · Free plan
              </p>
              <h1 className="mt-6 text-balance font-mono text-[2.35rem] font-semibold leading-[1.08] tracking-tight sm:text-5xl lg:text-[3.6rem]">
                Receipts, scanned <span className="text-primary">line by line.</span>
              </h1>
              <p className="mt-6 max-w-lg text-pretty text-base leading-7 text-foreground/80 md:text-lg md:leading-8">
                Photograph or upload any receipt. You get the merchant, date, every line item, tax
                and total as data you can check, fix and export as CSV or JSON.
              </p>
              <SignUpCta
                className="mt-9"
                secondary={{ href: "#features", label: "Read the spec" }}
              />
            </div>
            <OutputTabs
              className="reveal-up reveal-delay-1 w-full"
              tabs={[
                {
                  id: "photo",
                  label: "Photo",
                  panel: (
                    <div className="grid place-items-center rounded-2xl bg-card/60 py-8 ring-1 ring-border">
                      <ReceiptSlip className="w-64" scanning />
                    </div>
                  ),
                },
                { id: "fields", label: "Fields", panel: <ExtractedPanel /> },
                { id: "csv", label: "CSV", panel: <CsvSheet /> },
                { id: "json", label: "JSON", panel: <JsonBlock /> },
              ]}
            />
          </div>
        </section>

        <section
          className="scroll-mt-24 border-y border-border bg-secondary/25 px-5 py-20"
          id="how"
        >
          <div className="mx-auto max-w-6xl">
            <Eyebrow>How it works</Eyebrow>
            <h2 className="mt-3 text-3xl font-bold tracking-tight md:text-4xl">
              Four steps, one of them yours
            </h2>
            <ol className="mt-12 grid gap-px overflow-hidden rounded-2xl bg-border ring-1 ring-border sm:grid-cols-2 lg:grid-cols-4">
              {pipeline.map((p) => (
                <li className="bg-background p-6" key={p.step}>
                  <p className="font-mono text-xs text-muted-foreground">
                    <span className="text-primary">{p.step}</span> / {p.verb.toUpperCase()}
                  </p>
                  <p className="mt-4 truncate rounded-md bg-secondary/70 px-2.5 py-1.5 font-mono text-xs">
                    {p.detail}
                  </p>
                  <h3 className="mt-4 font-semibold">{p.verb}</h3>
                  <p className="mt-1 text-sm leading-6 text-muted-foreground">{p.note}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="scroll-mt-24 px-5 py-24 md:py-28" id="features">
          <div className="mx-auto grid max-w-6xl gap-12 lg:grid-cols-[1fr_1.4fr]">
            <div>
              <Eyebrow>The spec</Eyebrow>
              <h2 className="mt-3 text-balance text-3xl font-bold tracking-tight md:text-4xl">
                What it does today, in numbers we enforce
              </h2>
              <p className="mt-4 max-w-sm text-muted-foreground">
                No benchmarks we haven&apos;t run, no features we haven&apos;t shipped. If it&apos;s
                on this list, it works on the free plan right now.
              </p>
            </div>
            <dl className="divide-y divide-border rounded-2xl bg-card/50 font-mono text-sm ring-1 ring-border">
              {specs.map((s) => (
                <div
                  className="grid gap-1 px-5 py-4 sm:grid-cols-[8rem_1fr] sm:gap-6"
                  key={s.label}
                >
                  <dt className="text-muted-foreground">{s.label}</dt>
                  <dd>
                    <span className="text-foreground">{s.value}</span>
                    <span className="mt-1 block font-sans text-xs text-muted-foreground">
                      {s.note}
                    </span>
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        <section
          aria-labelledby="c-flow"
          className="border-t border-border bg-secondary/20 px-5 py-24 md:py-28"
        >
          <div className="mx-auto max-w-6xl">
            <Eyebrow>Where your data goes</Eyebrow>
            <h2
              className="mt-3 max-w-xl text-balance text-3xl font-bold tracking-tight md:text-4xl"
              id="c-flow"
            >
              Four stops, all of them named
            </h2>
            <ol className="mt-12 grid gap-4 md:grid-cols-4">
              {dataFlow.map(([where, what], i) => (
                <li
                  className="relative rounded-2xl bg-background p-6 ring-1 ring-border"
                  key={where}
                >
                  <p className="font-mono text-xs text-primary">{String(i + 1).padStart(2, "0")}</p>
                  <h3 className="mt-3 font-semibold">{where}</h3>
                  <p className="mt-1.5 text-sm leading-6 text-muted-foreground">{what}</p>
                </li>
              ))}
            </ol>
            <p className="mt-6 text-sm text-muted-foreground">
              Details in our{" "}
              <Link className="text-primary underline-offset-4 hover:underline" href="/privacy">
                privacy policy
              </Link>
              .
            </p>
          </div>
        </section>

        <section className="scroll-mt-24 border-t border-border px-5 py-24 md:py-28" id="pricing">
          <div className="mx-auto grid max-w-6xl items-center gap-12 lg:grid-cols-[1fr_1fr]">
            <div>
              <Eyebrow>Pricing</Eyebrow>
              <h2 className="mt-3 text-3xl font-bold tracking-tight md:text-4xl">
                The bill, itemised
              </h2>
              <p className="mt-4 max-w-sm text-muted-foreground">
                One plan today, and it costs nothing. Paid plans come later, once there&apos;s more
                to pay for.
              </p>
            </div>
            <div className="receipt-edge mx-auto w-full max-w-md bg-[var(--paper)] px-7 pb-12 pt-8 font-mono text-sm text-[var(--paper-ink)] shadow-2xl shadow-black/60">
              <p className="text-center font-bold tracking-[0.2em]">RECEIPTOCR</p>
              <p className="text-center text-xs text-[var(--paper-muted)]">Plans as of today</p>
              <div className="my-4 border-t border-dashed border-[var(--paper-muted)]/60" />
              <dl className="flex flex-col gap-2">
                <Leader label="Free plan" value="$0.00" />
                <Leader label="Receipts / day" value={String(freePlan.receiptsPerDay)} />
                <Leader label="Workspaces" value={String(freePlan.workspaces)} />
                <Leader label="CSV + JSON export" value="incl." />
                <Leader label="Card required" value="no" />
              </dl>
              <div className="my-4 border-t border-dashed border-[var(--paper-muted)]/60" />
              <p className="text-xs text-[var(--paper-muted)]">COMING SOON</p>
              <ul className="mt-2 flex flex-col gap-1 text-xs">
                {comingSoon.map((c) => (
                  <li key={c.title}>* {c.title}</li>
                ))}
              </ul>
              <div className="my-4 border-t border-dashed border-[var(--paper-muted)]/60" />
              <p className="flex justify-between text-base font-bold">
                <span>TOTAL DUE</span>
                <span>$0.00</span>
              </p>
              <div className="mt-6 flex flex-col gap-2">
                <Link className={cn(buttonVariants({ size: "lg" }), "w-full")} href="/sign-up">
                  Get started free <ArrowRight aria-hidden className="size-4" />
                </Link>
                <ContactButton
                  className="h-11 w-full text-[var(--paper-ink)] hover:bg-black/5"
                  topic="use-case"
                  variant="ghost"
                >
                  Need more? Contact us
                </ContactButton>
              </div>
            </div>
          </div>
        </section>

        <section className="scroll-mt-24 border-t border-border px-5 py-24 md:py-28" id="faq">
          <div className="mx-auto grid max-w-6xl gap-10 lg:grid-cols-[1fr_1.4fr]">
            <div>
              <Eyebrow>FAQ</Eyebrow>
              <h2 className="mt-3 text-3xl font-bold tracking-tight md:text-4xl">
                Questions, answered
              </h2>
            </div>
            <FaqList mono />
          </div>
        </section>

        <section className="border-t border-border px-5 py-24 text-center md:py-28">
          <h2 className="mx-auto max-w-2xl text-balance font-mono text-3xl font-semibold tracking-tight md:text-4xl">
            Get your receipts out of the shoebox
          </h2>
          <p className="mx-auto mt-4 max-w-md text-muted-foreground">
            Free to start, no card required. Your first receipt takes under a minute.
          </p>
          <SignUpCta align="center" className="mx-auto mt-9 max-w-xs sm:max-w-none" />
        </section>
      </main>
      <SiteFooter />
      <SupportWidget />
    </>
  );
}
