import { cn } from "@receipt-ocr/ui/lib/utils";
import Link from "next/link";
import { ctaClass, ghostClass } from "./chrome";
import { HeroDemo } from "./demo";
import { Fig, container } from "./parts";

const outcomes = [
  { head: "Every line, read", body: "Merchant, date, each item, tax and total. No typing." },
  {
    head: "Only the doubtful ones",
    body: "Low-confidence lines say “Check this line”, so you know where to look.",
  },
  {
    head: "Rows your books accept",
    body: "The CSV opens in Excel or Google Sheets, and imports into QuickBooks or Xero.",
  },
  {
    head: "Ready for your bookkeeper",
    body: "Invite them to your workspace, or hand them the export.",
  },
];

export function Hero() {
  return (
    <section aria-labelledby="fl-hero-title" className="relative">
      {/* Ledger columns run the full height of the hero, aligned to the page grid. */}
      <div
        aria-hidden="true"
        className={cn(container, "pointer-events-none absolute inset-x-0 inset-y-0")}
      >
        <div className="fl-ledger h-full w-full" />
      </div>
      <div
        className={cn(
          container,
          "relative grid gap-x-6 gap-y-12 pt-10 sm:pt-14 lg:grid-cols-12 lg:items-start lg:pt-16",
        )}
      >
        <div className="lg:col-span-5 lg:pt-2">
          <p className="text-sm font-medium text-primary">For freelancers and small businesses</p>
          <h1
            className="mt-4 text-[44px] font-semibold leading-[0.98] tracking-[-0.04em] text-balance sm:text-[60px] lg:text-[68px]"
            id="fl-hero-title"
          >
            Stop typing in receipts.
          </h1>
          <p className="mt-6 max-w-[44ch] text-[18px] leading-7 text-(--fl-ink-2) text-pretty">
            Snap a photo or drop in a scan. receiptOCR reads every line, flags the few it isn&apos;t
            sure of, and gives you rows ready for your books, or to hand to your bookkeeper.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Link className={ctaClass} href="/sign-up">
              Start free
            </Link>
            <Link className={ghostClass} href="#data">
              See where your data goes
            </Link>
          </div>
          <p className="mt-4 text-sm text-(--fl-ink-2)">Free to start · no card</p>
        </div>

        <div className="min-w-0 lg:col-span-7">
          <HeroDemo />
          <div className="mt-3">
            <Fig n="1">
              A scripted sample, played in your browser. The receipt is read line by line, the
              record fills in, and a row lands in the export.
            </Fig>
          </div>
        </div>

        {/*
          Opaque, so the ledger columns stop at the rule. Set as ruled ledger entries on the page
          grid rather than a row of tiles.
        */}
        <div className="grid gap-x-6 border-t border-foreground bg-background pt-5 pb-6 lg:col-span-12 lg:grid-cols-12">
          <p className="flex gap-3 text-sm text-muted-foreground lg:col-span-3">
            <span className="fl-mono text-foreground">00</span>
            In short
          </p>
          <dl className="mt-4 border-t border-border lg:col-span-9 lg:mt-0 lg:border-t-0">
            {outcomes.map((o, i) => (
              <div
                className="grid gap-x-6 gap-y-1 border-b border-border py-3.5 first:lg:pt-0 sm:grid-cols-[2.5rem_minmax(0,15rem)_1fr]"
                key={o.head}
              >
                <span aria-hidden="true" className="fl-mono text-xs leading-6 text-primary">
                  {String.fromCharCode(97 + i)}.
                </span>
                <dt className="text-[17px] font-semibold tracking-[-0.01em]">{o.head}</dt>
                <dd className="text-[15px] leading-6 text-(--fl-ink-2)">{o.body}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </section>
  );
}
