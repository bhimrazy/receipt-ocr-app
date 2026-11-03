import { buttonVariants } from "@receipt-ocr/ui/components/button";
import { cn } from "@receipt-ocr/ui/lib/utils";
import { ArrowRight, Check, X } from "lucide-react";
import { Instrument_Serif } from "next/font/google";
import Link from "next/link";
import { ContactButton } from "@/components/contact-button";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { SupportWidget } from "@/components/support-widget";
import { comingSoon, freePlan } from "./content";
import { FaqList } from "./faq";
import { CsvSheet, ExtractedPanel, ReceiptSlip, UploadQueue } from "./previews";
import { BackdropGrid, Eyebrow, SignUpCta } from "./primitives";

const serif = Instrument_Serif({ subsets: ["latin"], weight: "400", style: ["normal", "italic"], display: "swap" });

const oldWay = [
  "Typing every receipt into a spreadsheet, one cell at a time",
  "Squinting at faded thermal paper to read the total",
  "Finding the missing ones in a coat pocket in April",
];

const newWay = [
  "Photograph them as you go, or drop in 20 at once",
  "Check the score, fix anything that's off",
  "Hand your accountant one CSV",
];

const acts = [
  {
    n: "i.",
    title: "Capture",
    body: "Use your phone's camera in the browser, or drop in photos and scans. PNG, JPG and HEIC, up to 10 MB each.",
    visual: <UploadQueue />,
  },
  {
    n: "ii.",
    title: "Check",
    body: "Every receipt comes back as fields you can read at a glance, with a confidence score. If something looks wrong, change it.",
    visual: <ExtractedPanel compact />,
  },
  {
    n: "iii.",
    title: "Export",
    body: "One CSV for a receipt or your whole history. It opens in Excel, Google Sheets and Numbers, and it's the file your accountant asked for.",
    visual: <CsvSheet />,
  },
];

const promises = [
  ["Yours only", "Receipts are visible to you and the people you invite. Nobody else."],
  ["Read by Google's Gemini AI", "We send the image to Google's Gemini model to read it. We name it because you should know."],
  ["Delete from Settings", "Remove a receipt, or your whole account, yourself. No email to send, no form to fill."],
];

export function DirectionB() {
  return (
    <>
      <SiteHeader />
      <main className="overflow-x-clip bg-background text-foreground">
        <section className="relative px-5 pb-16 pt-32 text-center md:pt-44">
          <BackdropGrid />
          <div className="relative mx-auto max-w-4xl reveal-up">
            <Eyebrow>For freelancers and small businesses</Eyebrow>
            <h1
              className={cn(
                serif.className,
                "mt-6 text-balance text-[3.25rem] leading-[0.98] tracking-tight sm:text-7xl md:text-[5.5rem]",
              )}
            >
              Your receipts, <em className="text-primary">sorted</em> before tax time.
            </h1>
            <p className="mx-auto mt-7 max-w-xl text-pretty text-base leading-7 text-foreground/80 md:text-lg md:leading-8">
              Photograph or upload any receipt. We read the merchant, date, items, tax and total, so you can check it,
              fix it, and export a CSV for your accountant.
            </p>
            <SignUpCta align="center" className="mx-auto mt-9 max-w-xs sm:max-w-none" />
          </div>

          {/* The transformation: paper on the left, rows on the right. */}
          <div className="reveal-up reveal-delay-2 relative mx-auto mt-20 grid max-w-5xl items-center gap-10 md:grid-cols-[0.8fr_auto_1.2fr]">
            <div className="relative mx-auto h-[23rem] w-72">
              <div className="absolute left-1 top-8 h-72 w-56 rotate-[-9deg] bg-[var(--paper)]/55 receipt-edge" aria-hidden />
              <div className="absolute right-0 top-3 h-72 w-56 rotate-[7deg] bg-[var(--paper)]/75 receipt-edge" aria-hidden />
              <ReceiptSlip className="absolute inset-x-4 top-0 rotate-[-2deg]" />
            </div>
            <ArrowRight aria-hidden className="mx-auto size-6 rotate-90 text-primary md:rotate-0" />
            <CsvSheet className="text-left" />
          </div>
        </section>

        <section aria-labelledby="b-compare" className="border-t border-border px-5 py-24 md:py-28">
          <div className="mx-auto max-w-5xl">
            <h2 className={cn(serif.className, "max-w-2xl text-balance text-4xl leading-tight md:text-5xl")} id="b-compare">
              Tax season shouldn&apos;t start with a shoebox.
            </h2>
            <div className="mt-12 grid gap-5 md:grid-cols-2">
              <div className="rounded-2xl bg-secondary/30 p-7 ring-1 ring-border">
                <h3 className="font-mono text-xs uppercase tracking-[0.18em] text-muted-foreground">The old way</h3>
                <ul className="mt-5 flex flex-col gap-4">
                  {oldWay.map((line) => (
                    <li className="flex gap-3 text-muted-foreground" key={line}>
                      <X aria-hidden className="mt-1 size-4 shrink-0" />
                      {line}
                    </li>
                  ))}
                </ul>
              </div>
              <div className="rounded-2xl bg-primary/[0.05] p-7 ring-1 ring-primary/30">
                <h3 className="font-mono text-xs uppercase tracking-[0.18em] text-primary">With receiptOCR</h3>
                <ul className="mt-5 flex flex-col gap-4">
                  {newWay.map((line) => (
                    <li className="flex gap-3" key={line}>
                      <Check aria-hidden className="mt-1 size-4 shrink-0 text-primary" />
                      {line}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </section>

        <section className="scroll-mt-24 border-t border-border bg-secondary/20 px-5 py-24 md:py-28" id="how">
          <div className="mx-auto max-w-5xl">
            <Eyebrow>How it works</Eyebrow>
            <h2 className={cn(serif.className, "mt-3 text-4xl md:text-5xl")}>Three steps, no typing.</h2>
            <ol className="mt-14 flex flex-col gap-16">
              {acts.map((act) => (
                <li className="grid items-start gap-8 md:grid-cols-[6rem_1fr_1.2fr]" key={act.n}>
                  <span aria-hidden className={cn(serif.className, "text-6xl italic leading-none text-primary")}>
                    {act.n}
                  </span>
                  <div>
                    <h3 className="text-2xl font-semibold tracking-tight">{act.title}</h3>
                    <p className="mt-3 max-w-sm leading-7 text-muted-foreground">{act.body}</p>
                  </div>
                  {act.visual}
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="scroll-mt-24 border-t border-border px-5 py-24 md:py-28" id="features">
          <div className="mx-auto max-w-5xl">
            <Eyebrow>Your data</Eyebrow>
            <h2 className={cn(serif.className, "mt-3 max-w-2xl text-balance text-4xl md:text-5xl")}>
              Financial paperwork deserves plain answers.
            </h2>
            <dl className="mt-12 grid gap-px overflow-hidden rounded-2xl bg-border ring-1 ring-border md:grid-cols-3">
              {promises.map(([title, body]) => (
                <div className="bg-background p-7" key={title}>
                  <dt className="font-semibold">{title}</dt>
                  <dd className="mt-2 text-sm leading-6 text-muted-foreground">{body}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        <section className="scroll-mt-24 border-t border-border bg-secondary/20 px-5 py-24 md:py-28" id="pricing">
          <div className="mx-auto max-w-5xl text-center">
            <Eyebrow>Pricing</Eyebrow>
            <h2 className={cn(serif.className, "mx-auto mt-4 max-w-3xl text-balance text-5xl leading-[1.05] md:text-6xl")}>
              Free. {freePlan.receiptsPerDay} receipts a day. <em className="text-primary">No card.</em>
            </h2>
            <p className="mx-auto mt-5 max-w-lg text-muted-foreground">
              The {freePlan.name.toLowerCase()} includes {freePlan.workspaces} workspace, CSV export and every feature on
              this page. There&apos;s nothing to upgrade to yet.
            </p>
            <Link className={cn(buttonVariants({ size: "lg" }), "mt-8 w-full sm:w-auto")} href="/sign-up">
              Get started free <ArrowRight aria-hidden className="size-4" />
            </Link>
            <div className="mx-auto mt-14 max-w-3xl rounded-2xl p-6 text-left ring-1 ring-border">
              <p className="font-mono text-xs uppercase tracking-[0.18em] text-muted-foreground">Coming soon</p>
              <ul className="mt-4 grid gap-5 sm:grid-cols-3">
                {comingSoon.map((item) => (
                  <li key={item.title}>
                    <p className="font-medium">{item.title}</p>
                    <p className="mt-1 text-sm text-muted-foreground">{item.desc}</p>
                  </li>
                ))}
              </ul>
              <ContactButton className="mt-6 h-11" topic="use-case" variant="outline">
                Need more now? Contact us
              </ContactButton>
            </div>
          </div>
        </section>

        <section className="scroll-mt-24 border-t border-border px-5 py-24 md:py-28" id="faq">
          <div className="mx-auto max-w-3xl">
            <h2 className={cn(serif.className, "text-center text-4xl md:text-5xl")}>Questions, answered.</h2>
            <FaqList className="mt-12" />
          </div>
        </section>

        <section className="relative overflow-hidden border-t border-border px-5 py-24 text-center md:py-32">
          <BackdropGrid className="opacity-30" />
          <div className="relative mx-auto max-w-2xl">
            <h2 className={cn(serif.className, "text-balance text-5xl leading-[1.05] md:text-6xl")}>
              Get your receipts out of the <em className="text-primary">shoebox.</em>
            </h2>
            <p className="mx-auto mt-5 max-w-md text-muted-foreground">
              Free to start, no card required. Your first receipt takes under a minute.
            </p>
            <SignUpCta align="center" className="mx-auto mt-9 max-w-xs sm:max-w-none" />
          </div>
        </section>
      </main>
      <SiteFooter />
      <SupportWidget />
    </>
  );
}
