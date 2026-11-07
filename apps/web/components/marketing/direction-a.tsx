import { cn } from "@receipt-ocr/ui/lib/utils";
import { Camera, Download, Lock, PencilLine, Users } from "lucide-react";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { SupportWidget } from "@/components/support-widget";
import { demoReceipt } from "./content";
import { FaqList } from "./faq";
import { CsvSheet, ExtractedPanel, ReceiptSlip, UploadQueue } from "./previews";
import { BackdropGrid, Eyebrow, SignUpCta } from "./primitives";
import { ComingSoonCard, FreePlanCard } from "./pricing";

const proof = [
  ["PNG · JPG · HEIC", "Phone photos or scans, up to 10 MB"],
  ["20 at a time", "Drop a month of receipts at once"],
  ["Scored", "A confidence score on every receipt"],
  ["CSV", "One file your accountant can open"],
];

function EditFragment() {
  return (
    <div
      role="img"
      aria-label="Editing a receipt: merchant, date, category and total fields"
      className="rounded-xl bg-card p-5 ring-1 ring-white/10"
    >
      <div aria-hidden className="grid grid-cols-2 gap-3 text-xs">
        {[
          ["Merchant", "Paper & Co."],
          ["Date", demoReceipt.isoDate],
          ["Category", demoReceipt.category],
          ["Total", demoReceipt.total],
        ].map(([label, value], i) => (
          <div key={label}>
            <p className="mb-1.5 font-medium text-muted-foreground">{label}</p>
            <p
              className={cn(
                "rounded-lg bg-background/60 px-3 py-2.5 font-mono text-sm ring-1 ring-inset",
                i === 0 ? "ring-2 ring-primary" : "ring-foreground/20",
              )}
            >
              {value}
              {i === 0 && (
                <span className="ml-px inline-block h-4 w-px translate-y-0.5 bg-primary motion-safe:animate-pulse" />
              )}
            </p>
          </div>
        ))}
      </div>
      <div aria-hidden className="mt-4 flex justify-end">
        <span className="rounded-full bg-primary px-4 py-2 text-xs font-medium text-primary-foreground">
          Save changes
        </span>
      </div>
    </div>
  );
}

const figures = [
  {
    fig: "01",
    title: "Snap it or drop it in",
    body: "Take a photo on your phone, or drag in up to 20 images at once. Each one is scanned in the background while you carry on.",
    visual: <UploadQueue />,
  },
  {
    fig: "02",
    title: "Check it, fix it",
    body: "Merchant, date, line items, tax and total come back with a confidence score that tells you when to take a second look. Edit any field before it goes anywhere.",
    visual: <EditFragment />,
  },
  {
    fig: "03",
    title: "Export a clean CSV",
    body: "Download one receipt or your whole history as a CSV that opens in Excel, Google Sheets or Numbers. The numbers you fixed are the numbers you get.",
    visual: <CsvSheet />,
  },
];

const features = [
  {
    icon: Camera,
    title: "Made for your phone",
    desc: "Open it in your phone's browser and use the camera. No app to install.",
  },
  {
    icon: PencilLine,
    title: "You have the last word",
    desc: "Edit the merchant, date, category and amounts. Your corrections are what gets exported.",
  },
  {
    icon: Lock,
    title: "Private to your workspace",
    desc: "Only you and the people you invite can see your receipts. Delete any of them, or your account, from Settings.",
  },
  {
    icon: Users,
    title: "Share with your bookkeeper",
    desc: "Invite a partner or bookkeeper to your workspace so they see the same receipts you do.",
  },
  {
    icon: Download,
    title: "Your data, exportable",
    desc: "CSV for any receipt or everything at once, or copy a receipt as JSON. No export fees.",
  },
];

export function DirectionA() {
  return (
    <>
      <SiteHeader />
      <main className="overflow-x-clip bg-background text-foreground">
        {/* Hero: the product output is the hero image. */}
        <section className="relative px-5 pb-20 pt-32 md:pt-40 lg:pb-28">
          <BackdropGrid />
          <div className="hero-aurora pointer-events-none absolute left-[70%] top-[45%] size-[640px] -translate-x-1/2 -translate-y-1/2 rounded-full opacity-50" />
          <div className="relative mx-auto grid max-w-6xl items-center gap-14 lg:grid-cols-[1fr_1.05fr]">
            <div className="reveal-up">
              <Eyebrow>Receipt scanning for freelancers</Eyebrow>
              <h1 className="mt-5 text-balance text-[2.6rem] font-bold leading-[1.04] tracking-tight sm:text-6xl">
                Snap a receipt.
                <br />
                <span className="text-gradient">Get a spreadsheet.</span>
              </h1>
              <p className="mt-6 max-w-lg text-pretty text-base leading-7 text-foreground/80 md:text-lg md:leading-8">
                Photograph or upload any receipt. We scan the merchant, date, items, tax and total,
                so you can check it, fix it, and export a CSV for your accountant.
              </p>
              <SignUpCta className="mt-9" secondary={{ href: "#how", label: "See how it works" }} />
            </div>

            <div className="reveal-up reveal-delay-1 relative mx-auto w-full max-w-md lg:max-w-none">
              <ReceiptSlip
                className="absolute -left-2 top-6 hidden w-56 -rotate-6 sm:block lg:-left-10"
                scanning
              />
              <ExtractedPanel className="relative sm:ml-auto sm:w-[78%] lg:w-[80%]" />
            </div>
          </div>
        </section>

        {/* Proof strip: only facts the product enforces. */}
        <section aria-label="At a glance" className="border-y border-border bg-secondary/30 px-5">
          <dl className="mx-auto grid max-w-6xl grid-cols-2 lg:grid-cols-4">
            {proof.map(([value, label], i) => (
              <div
                className={cn(
                  "py-7 pr-4",
                  i % 2 === 1 && "pl-4 lg:pl-6",
                  i >= 2 && "border-t border-border lg:border-t-0",
                  i > 0 && "lg:border-l lg:border-border lg:pl-6",
                )}
                key={value}
              >
                <dt className="sr-only">{label}</dt>
                <dd className="font-mono text-lg font-semibold tracking-tight">{value}</dd>
                <dd className="mt-1 text-sm text-muted-foreground">{label}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="scroll-mt-24 px-5 py-24 md:py-32" id="how">
          <div className="mx-auto max-w-6xl">
            <Eyebrow>How it works</Eyebrow>
            <h2 className="mt-3 max-w-xl text-balance text-3xl font-bold tracking-tight md:text-4xl">
              From a crumpled receipt to a clean row in three steps
            </h2>
            <div className="mt-16 flex flex-col gap-20 md:gap-28">
              {figures.map((f, i) => (
                <div className="grid items-center gap-8 md:grid-cols-2 md:gap-16" key={f.fig}>
                  <div className={cn(i % 2 === 1 && "md:order-2")}>
                    <p className="font-mono text-xs text-muted-foreground">
                      <span className="text-primary">Fig. {f.fig}</span> / 03
                    </p>
                    <h3 className="mt-3 text-2xl font-semibold tracking-tight">{f.title}</h3>
                    <p className="mt-3 max-w-md leading-7 text-muted-foreground">{f.body}</p>
                  </div>
                  <div className={cn("w-full", i % 2 === 1 && "md:order-1")}>{f.visual}</div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section
          className="scroll-mt-24 border-t border-border bg-secondary/20 px-5 py-24 md:py-28"
          id="features"
        >
          <div className="mx-auto grid max-w-6xl gap-12 lg:grid-cols-[1fr_2fr]">
            <div>
              <Eyebrow>Features</Eyebrow>
              <h2 className="mt-3 text-balance text-3xl font-bold tracking-tight md:text-4xl">
                The boring parts, handled
              </h2>
              <p className="mt-4 max-w-sm text-muted-foreground">
                Everything here works today on the free plan. No trials, no locked features.
              </p>
            </div>
            <ul className="grid gap-x-10 gap-y-9 sm:grid-cols-2">
              {features.map(({ icon: Icon, title, desc }) => (
                <li className="flex gap-4" key={title}>
                  <Icon aria-hidden className="mt-0.5 size-5 shrink-0 text-primary" />
                  <div>
                    <h3 className="font-semibold">{title}</h3>
                    <p className="mt-1.5 text-sm leading-6 text-muted-foreground">{desc}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="scroll-mt-24 border-t border-border px-5 py-24 md:py-28" id="pricing">
          <div className="mx-auto max-w-5xl">
            <Eyebrow>Pricing</Eyebrow>
            <h2 className="mt-3 text-3xl font-bold tracking-tight md:text-4xl">
              Free while we&apos;re early
            </h2>
            <p className="mt-4 max-w-xl text-muted-foreground">
              One plan, and it&apos;s free. Paid plans with higher limits come later, and we&apos;ll
              only charge for what we&apos;ve actually built.
            </p>
            <div className="mt-12 grid gap-5 md:grid-cols-2">
              <FreePlanCard />
              <ComingSoonCard />
            </div>
          </div>
        </section>

        <section className="scroll-mt-24 border-t border-border px-5 py-24 md:py-28" id="faq">
          <div className="mx-auto grid max-w-6xl gap-10 lg:grid-cols-[1fr_2fr]">
            <div>
              <Eyebrow>FAQ</Eyebrow>
              <h2 className="mt-3 text-3xl font-bold tracking-tight md:text-4xl">
                Questions, answered
              </h2>
            </div>
            <FaqList />
          </div>
        </section>

        <section className="px-5 pb-24 md:pb-28">
          <div className="relative mx-auto max-w-6xl overflow-hidden rounded-3xl bg-primary/[0.06] px-6 py-16 ring-1 ring-primary/25 md:px-14">
            <BackdropGrid className="opacity-30" />
            <div className="relative grid items-center gap-10 md:grid-cols-[1.4fr_1fr]">
              <div>
                <h2 className="text-balance text-3xl font-bold tracking-tight md:text-4xl">
                  Get your receipts out of the shoebox
                </h2>
                <p className="mt-4 max-w-md text-muted-foreground">
                  Free to start, no card required. Your first receipt takes under a minute.
                </p>
              </div>
              <SignUpCta />
            </div>
          </div>
        </section>
      </main>
      <SiteFooter />
      <SupportWidget />
    </>
  );
}
