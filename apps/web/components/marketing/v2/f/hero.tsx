import { Check, Download, ScanLine, TriangleAlert } from "lucide-react";
import { demoReceipt, freePlan } from "../../content";
import { Kicker, StartFree } from "./bits";
import { hero } from "./copy";
import { FHeader } from "./header";

export function FHero() {
  return (
    <div className="f-on-orange relative bg-background text-foreground">
      <FHeader />
      <section
        aria-labelledby="f-hero-title"
        className="relative mx-auto grid max-w-6xl gap-12 px-4 pb-20 pt-8 sm:px-6 md:pt-14 lg:grid-cols-[1.15fr_1fr] lg:items-center lg:gap-6 lg:pb-28"
      >
        <div>
          <Kicker className="max-w-full bg-[var(--f-cream)] text-[var(--f-ink)]">
            {hero.eyebrow}
          </Kicker>
          <h1 className="f-display mt-6 text-[clamp(5rem,24vw,10rem)] sm:mt-8" id="f-hero-title">
            Snap it.
            <span className="mt-2 block">
              <span className="f-stamp f-tilt inline-block rounded-[0.18em] bg-[var(--f-ink)] px-[0.14em] pb-[0.1em] pt-[0.02em] text-[var(--f-cream)] [--f-tilt:-3deg] [animation-delay:150ms]">
                Sorted.
              </span>
            </span>
          </h1>
          <p className="mt-8 max-w-xl text-lg font-medium leading-relaxed sm:text-xl">
            {hero.lead}
          </p>
          <div className="mt-8 flex flex-col gap-4 sm:flex-row sm:items-center">
            <StartFree className="w-full sm:w-auto" />
            <a
              className="inline-flex min-h-11 items-center justify-center rounded-full px-4 text-base font-bold underline decoration-2 underline-offset-4 hover:decoration-4 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring"
              href="#how"
            >
              See how it works
            </a>
          </div>
          <ul className="mt-6 flex flex-wrap gap-x-5 gap-y-2 text-[15px] font-bold">
            {hero.reassurance.map((item) => (
              <li className="flex items-center gap-1.5" key={item}>
                <Check aria-hidden className="size-4" strokeWidth={3} />
                {item}
              </li>
            ))}
          </ul>
        </div>

        <PhoneMoment />
      </section>
    </div>
  );
}

const lines = demoReceipt.items.slice(0, 4);

/** Snap → sorted, drawn in HTML. Decorative copy of the demo receipt, described by its label. */
function PhoneMoment() {
  return (
    <figure
      aria-label={`Example: a photo of a ${demoReceipt.merchant} receipt becomes a sorted record, ${demoReceipt.total}, category ${demoReceipt.category}, ${demoReceipt.confidence}% confidence.`}
      className="relative mx-auto w-full max-w-[22rem] lg:mr-4"
      role="img"
    >
      {/* Price sticker */}
      <div
        aria-hidden
        className="f-stamp f-wiggle f-tilt absolute -right-3 -top-12 z-20 sm:-right-24 sm:-top-16 [--f-tilt:12deg] [animation-delay:1.5s]"
      >
        <div className="f-burst flex size-28 flex-col items-center justify-center bg-[var(--f-yellow)] text-center text-[var(--f-ink)] sm:size-36">
          <span className="f-display text-4xl sm:text-5xl">$0</span>
          <span className="mt-1 text-xs font-extrabold uppercase leading-tight tracking-wide">
            {freePlan.receiptsPerDay} a day
          </span>
        </div>
      </div>

      <div
        aria-hidden
        className="f-pop-lg rounded-[3rem] [--f-shadow:var(--f-ink)] border-2 border-[var(--f-ink)] bg-[var(--f-ink)] p-2.5"
      >
        <div className="relative h-[34rem] overflow-hidden rounded-[2.4rem] bg-[var(--f-cream)] text-[var(--f-ink)]">
          {/* Status bar + notch */}
          <div className="flex items-center justify-between px-7 pt-3.5 font-mono text-xs font-bold">
            <span>9:41</span>
            <span className="h-6 w-24 rounded-full bg-[var(--f-ink)]" />
            <span className="flex gap-1">
              <span className="h-2.5 w-1 rounded-sm bg-[var(--f-ink)]" />
              <span className="h-2.5 w-1 rounded-sm bg-[var(--f-ink)]" />
              <span className="h-2.5 w-1 rounded-sm bg-[var(--f-ink)]/30" />
            </span>
          </div>

          <div className="mt-4 flex items-center justify-between px-5">
            <span className="text-lg font-extrabold">Upload</span>
            <span className="flex items-center gap-1.5 rounded-full bg-[var(--f-ink)] px-3 py-1.5 text-xs font-bold text-[var(--f-cream)]">
              <ScanLine className="size-3.5" strokeWidth={2.5} />
              Take a photo
            </span>
          </div>

          {/* The photographed receipt */}
          <div className="relative mx-auto mt-5 w-[78%] -rotate-3">
            <div className="f-torn bg-[var(--f-paper)] px-4 pb-6 pt-4 font-mono text-[11px] leading-5 shadow-[0_10px_24px_-12px_rgb(22_17_13/0.6)]">
              <p className="text-center text-xs font-bold">{demoReceipt.shortMerchant}</p>
              <p className="text-center text-[10px] text-[var(--f-ink-soft)]">
                {demoReceipt.date} · {demoReceipt.time}
              </p>
              <div className="my-2 border-t border-dashed border-[var(--f-ink)]/40" />
              {lines.map((item) => (
                <p className="flex justify-between gap-2" key={item.name}>
                  <span className="truncate">{item.name}</span>
                  <span className="tabular-nums">{item.price}</span>
                </p>
              ))}
              <p className="text-[var(--f-ink-soft)]">+1 more</p>
              <div className="my-2 border-t border-dashed border-[var(--f-ink)]/40" />
              <p className="flex justify-between font-bold">
                <span>TOTAL</span>
                <span className="tabular-nums">{demoReceipt.total}</span>
              </p>
            </div>
            <span className="f-scanline absolute inset-x-[-6%] top-0 h-1 rounded-full bg-[var(--f-orange)] shadow-[0_0_0_3px_rgb(255_90_31/0.25)] [--f-scan-distance:15rem]" />
          </div>

          {/* The sorted result */}
          <div className="f-rise absolute inset-x-3 bottom-3 rounded-[1.8rem] border-2 border-[var(--f-ink)] bg-[var(--f-paper)] p-4 [animation-delay:1.25s]">
            <div className="flex items-center justify-between">
              <span className="inline-flex items-center gap-1 rounded-full bg-[var(--f-orange)] px-2.5 py-1 text-xs font-extrabold">
                <Check className="size-3.5" strokeWidth={3} />
                Sorted
              </span>
              <span className="font-mono text-xs font-bold">{demoReceipt.confidence}% sure</span>
            </div>
            <p className="mt-3 text-[15px] font-extrabold leading-tight">{demoReceipt.merchant}</p>
            <p className="mt-0.5 text-xs font-medium text-[var(--f-ink-soft)]">
              {demoReceipt.date} · {demoReceipt.category}
            </p>
            <div className="mt-3 flex items-end justify-between border-t-2 border-dashed border-[var(--f-ink)]/25 pt-3">
              <div className="text-xs font-bold">
                <p>{demoReceipt.items.length} items</p>
                <p className="mt-1 inline-flex items-center gap-1 rounded-md bg-[var(--f-yellow)] px-1.5 py-0.5">
                  <TriangleAlert className="size-3" strokeWidth={2.75} />1 to check
                </p>
              </div>
              <p className="font-mono text-3xl font-bold tabular-nums tracking-tight">
                {demoReceipt.total}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* CSV chip */}
      <div
        aria-hidden
        className="f-stamp f-pop f-tilt absolute -bottom-5 -left-2 z-20 flex items-center gap-2 rounded-2xl border-2 border-[var(--f-ink)] bg-[var(--f-cream)] px-3.5 py-2.5 text-sm font-extrabold text-[var(--f-ink)] [--f-tilt:-6deg] [animation-delay:1.8s] sm:-left-10"
      >
        <Download className="size-4" strokeWidth={2.75} />
        receipts.csv
      </div>
    </figure>
  );
}
