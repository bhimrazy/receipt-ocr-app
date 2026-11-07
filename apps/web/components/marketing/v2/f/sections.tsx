import { cn } from "@receipt-ocr/ui/lib/utils";
import {
  Check,
  Cloud,
  HardDrive,
  Loader,
  Smartphone,
  Sparkles,
  TriangleAlert,
  Users,
} from "lucide-react";
import { demoExport, demoReceipt } from "../../content";
import { facts, queue, ticker, trustSteps } from "./copy";

export function FTicker() {
  const row = (hidden: boolean) => (
    <ul aria-hidden={hidden || undefined} className="flex shrink-0 items-center">
      {ticker.map((item) => (
        <li className="flex items-center gap-6 pr-6 text-lg font-extrabold sm:text-xl" key={item}>
          {item}
          <span aria-hidden className="size-2.5 rotate-45 bg-[var(--f-orange)]" />
        </li>
      ))}
    </ul>
  );
  return (
    <div className="f-on-ink f-marquee-wrap overflow-hidden border-y-2 border-[var(--f-ink)] bg-background py-4 text-foreground">
      <p className="sr-only">What ReceiptOCR scans from each receipt</p>
      <div className="f-marquee">
        {row(false)}
        {row(true)}
      </div>
    </div>
  );
}

function SectionTitle({
  id,
  kicker,
  children,
  className,
}: {
  id: string;
  kicker: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <p className="font-mono text-sm font-bold uppercase tracking-[0.18em] text-muted-foreground">
        {kicker}
      </p>
      <h2 className="f-display mt-4 text-[clamp(3rem,9vw,6rem)]" id={id}>
        {children}
      </h2>
    </div>
  );
}

const steps = [
  {
    n: "1",
    title: "Snap it",
    body: "Use your phone's camera right in the browser, or drop in up to 20 photos and scans at once. PNG, JPG or HEIC, up to 10 MB each.",
    visual: <QueueCard />,
    panel: "bg-[var(--f-orange)]",
  },
  {
    n: "2",
    title: "Check it",
    body: "Every receipt and every line gets a confidence score. Low ones are flagged, so you only look where it matters. Fix the shop, date, category or amounts in a few taps.",
    visual: <ConfidenceCard />,
    panel: "bg-[var(--f-yellow)]",
  },
  {
    n: "3",
    title: "Export it",
    body: "Download a CSV for one receipt or the whole workspace, ready for your spreadsheet or your accountant. Or copy a receipt as JSON.",
    visual: <CsvCard />,
    panel: "bg-[var(--f-ink)] [--f-shadow:var(--f-orange)]",
  },
];

export function FHow() {
  return (
    <section
      aria-labelledby="f-how-title"
      className="scroll-mt-4 px-4 py-24 sm:px-6 md:py-32"
      id="how"
    >
      <div className="mx-auto max-w-6xl">
        <SectionTitle id="f-how-title" kicker="How it works">
          Three steps.
          <br />
          No typing.
        </SectionTitle>

        <ol className="mt-16 flex flex-col gap-16 md:gap-24">
          {steps.map((step, i) => (
            <li className="grid items-center gap-8 md:grid-cols-2 md:gap-14" key={step.n}>
              <div className={cn(i % 2 === 1 && "md:order-2")}>
                <div className="flex items-center gap-4">
                  <span
                    aria-hidden
                    className="f-pop flex size-16 shrink-0 items-center justify-center rounded-2xl border-2 border-foreground bg-[var(--f-paper)] font-mono text-3xl font-bold"
                  >
                    {step.n}
                  </span>
                  <h3 className="f-display text-[clamp(2.75rem,7vw,4.5rem)]">
                    <span className="sr-only">Step {step.n}: </span>
                    {step.title}
                  </h3>
                </div>
                <p className="mt-6 max-w-md text-lg leading-relaxed text-muted-foreground">
                  {step.body}
                </p>
              </div>
              <div
                className={cn(
                  "f-pop-lg flex min-h-80 items-center justify-center rounded-[2rem] border-2 border-foreground p-5 sm:p-10",
                  step.panel,
                )}
              >
                {step.visual}
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

const card =
  "w-full max-w-sm rounded-3xl border-2 border-[var(--f-ink)] bg-[var(--f-paper)] text-[var(--f-ink)]";

function QueueCard() {
  return (
    <div
      aria-label="Upload queue: one scanned, one scanning, one queued"
      className={cn(card, "p-3")}
      role="img"
    >
      <div aria-hidden>
        {queue.map((row) => (
          <div
            className="flex items-center justify-between gap-3 rounded-2xl px-3 py-3 odd:bg-[var(--f-cream)]"
            key={row.file}
          >
            <span className="truncate font-mono text-sm font-bold">{row.file}</span>
            <span
              className={cn(
                "inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-xs font-extrabold",
                row.done
                  ? "bg-[var(--f-ink)] text-[var(--f-cream)]"
                  : "border-2 border-[var(--f-ink)]",
              )}
            >
              {row.done ? (
                <Check className="size-3.5" strokeWidth={3} />
              ) : row.status === "Scanning" ? (
                <Loader className="size-3.5" strokeWidth={3} />
              ) : null}
              {row.status}
            </span>
          </div>
        ))}
        <p className="px-3 pb-1 pt-3 text-xs font-bold text-[var(--f-ink-soft)]">
          Up to 20 files at a time
        </p>
      </div>
    </div>
  );
}

function ConfidenceCard() {
  return (
    <div className={cn(card, "p-5")}>
      <div className="flex items-baseline justify-between gap-3">
        <p className="font-extrabold">{demoReceipt.shortMerchant}</p>
        <p className="font-mono text-sm font-bold">{demoReceipt.confidence}% overall</p>
      </div>
      <ul className="mt-4 flex flex-col gap-3">
        {demoReceipt.items.slice(0, 4).map((item) => {
          const low = item.confidence < 80;
          return (
            <li key={item.name}>
              <div className="flex items-center justify-between gap-3 text-sm">
                <span
                  className={cn(
                    "truncate font-semibold",
                    low && "rounded bg-[var(--f-yellow)] px-1",
                  )}
                >
                  {item.name}
                </span>
                <span className="flex shrink-0 items-center gap-1.5 font-mono font-bold tabular-nums">
                  {low && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-[var(--f-ink)] px-2 py-0.5 font-sans text-[11px] font-extrabold text-[var(--f-cream)]">
                      <TriangleAlert aria-hidden className="size-3" strokeWidth={2.75} />
                      Check
                    </span>
                  )}
                  {item.confidence}%
                </span>
              </div>
              {/* Meter: track + fill, value labelled in text beside it. */}
              <div aria-hidden className="mt-1.5 h-1.5 rounded-full bg-[var(--f-ink)]/10">
                <div
                  className={cn(
                    "h-full rounded-full",
                    low
                      ? "bg-[var(--f-ink)] [background-image:repeating-linear-gradient(135deg,transparent_0_3px,var(--f-yellow)_3px_5px)]"
                      : "bg-[var(--f-ink)]",
                  )}
                  style={{ width: `${item.confidence}%` }}
                />
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function CsvCard() {
  const rows = demoExport;
  return (
    <div className={cn(card, "overflow-hidden")}>
      <div className="flex items-center justify-between border-b-2 border-[var(--f-ink)] px-4 py-3">
        <span className="font-mono text-sm font-bold">receipts.csv</span>
        <span className="rounded-full bg-[var(--f-orange)] px-2.5 py-1 text-xs font-extrabold">
          {demoExport.length} rows
        </span>
      </div>
      <table className="w-full font-mono text-xs sm:text-[13px]">
        <caption className="sr-only">Example CSV export</caption>
        <thead>
          <tr className="text-left text-[var(--f-ink-soft)]">
            <th className="px-4 py-2 font-semibold" scope="col">
              date
            </th>
            <th className="px-2 py-2 font-semibold" scope="col">
              merchant
            </th>
            <th className="px-4 py-2 text-right font-semibold" scope="col">
              total
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr className="border-t border-dashed border-[var(--f-ink)]/25" key={row.date}>
              <td className="whitespace-nowrap px-4 py-2 tabular-nums">{row.date.slice(5)}</td>
              <td className="truncate px-2 py-2 font-semibold">{row.merchant}</td>
              <td className="px-4 py-2 text-right font-bold tabular-nums">${row.total}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function FFacts() {
  const spans = [
    "col-span-1 md:col-span-2",
    "col-span-1 md:col-span-2",
    "col-span-2 md:col-span-2",
    "col-span-2 md:col-span-3",
    "col-span-2 md:col-span-3",
  ];
  const fills = [
    "bg-[var(--f-paper)]",
    "bg-[var(--f-orange)]",
    "bg-[var(--f-paper)]",
    "bg-[var(--f-yellow)]",
    "bg-[var(--f-paper)]",
  ];
  return (
    <section aria-labelledby="f-facts-title" className="px-4 pb-24 sm:px-6 md:pb-32">
      <div className="mx-auto max-w-6xl">
        <SectionTitle id="f-facts-title" kicker="The details">
          The small print,
          <br />
          in big print.
        </SectionTitle>
        <dl className="mt-14 grid grid-cols-2 gap-4 md:grid-cols-6 md:gap-5">
          {facts.map((fact, i) => (
            <div
              className={cn(
                "f-pop flex flex-col justify-between gap-6 rounded-[1.75rem] border-2 border-foreground p-5 text-[var(--f-ink)] sm:p-7",
                spans[i],
                fills[i],
              )}
              key={fact.big}
            >
              <dt className="f-display text-[clamp(2.5rem,8vw,4.5rem)]">
                {fact.big}
                {fact.unit && <span className="ml-2 text-[0.5em] tracking-tight">{fact.unit}</span>}
              </dt>
              <dd className="text-base font-semibold leading-snug">{fact.note}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}

const trustIcons = [Smartphone, HardDrive, Sparkles, Users];

export function FTrust() {
  return (
    <section
      aria-labelledby="f-trust-title"
      className="f-on-ink scroll-mt-4 bg-background px-4 py-24 text-foreground sm:px-6 md:py-32"
      id="trust"
    >
      <div className="mx-auto max-w-6xl">
        <div className="grid gap-8 md:grid-cols-[1.3fr_1fr] md:items-end">
          <SectionTitle id="f-trust-title" kicker="Your data">
            Where your
            <br />
            receipt goes.
          </SectionTitle>
          <p className="max-w-md text-lg leading-relaxed text-muted-foreground">
            The whole trip, in plain words. Delete any receipt, or your whole account, from Settings
            whenever you like.
          </p>
        </div>

        <ol className="relative mt-16 grid gap-5 md:grid-cols-4 md:gap-4">
          <span
            aria-hidden
            className="absolute left-8 top-8 h-[calc(100%-4rem)] border-l-[3px] border-dashed border-[var(--f-orange)] md:left-8 md:h-0 md:w-3/4 md:border-l-0 md:border-t-[3px]"
          />
          {trustSteps.map((step, i) => {
            const Icon = trustIcons[i] ?? Cloud;
            return (
              <li className="relative flex gap-5 md:flex-col" key={step.title}>
                <span
                  className={cn(
                    "flex size-16 shrink-0 items-center justify-center rounded-2xl border-2",
                    i === 2
                      ? "border-[var(--f-orange)] bg-[var(--f-orange)] text-[var(--f-ink)]"
                      : "border-[var(--f-cream)] bg-[var(--f-ink)] text-[var(--f-cream)]",
                  )}
                >
                  <Icon aria-hidden className="size-7" strokeWidth={2.25} />
                </span>
                <div className="pt-1 md:pt-0">
                  <p className="font-mono text-xs font-bold text-muted-foreground">
                    Stop {i + 1} of {trustSteps.length}
                  </p>
                  <h3 className="mt-1 text-2xl font-extrabold tracking-tight">{step.title}</h3>
                  <p className="mt-2 text-base leading-relaxed text-muted-foreground">
                    {step.body}
                  </p>
                </div>
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}
