"use client";

import { cn } from "@receipt-ocr/ui/lib/utils";
import { ChevronDown, CircleCheck, Loader2, RotateCcw, TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { earlierRows, MAX_ITEMS, type Sample, samples, stepsFor, tier, usd } from "./data";
import { Confidence, LineFlag } from "./parts";

type SampleId = Sample["id"];

const SCAN_MS = 1300;
const STEP_MS = 260;
const DEFAULT: SampleId = "office";

const byId = (id: SampleId) => samples.find((s) => s.id === id) ?? samples[0];
const amount = (n: number) => n.toFixed(2);

const reducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function statusText(key: string | null) {
  if (!key) return "Reading…";
  if (key.startsWith("item-")) return "Reading line items…";
  if (key === "category" || key === "row") return "Categorising…";
  if (key === "merchant" || key === "date") return "Reading the header…";
  return "Reading totals…";
}

/** Holds a value's space until it is read, so nothing shifts. `w` sizes the bar. */
function Slot({ shown, w, children }: { shown: boolean; w: string; children: React.ReactNode }) {
  return shown ? (
    <span className="fl-in inline-block max-w-full truncate align-bottom">{children}</span>
  ) : (
    <span aria-hidden="true" className={cn("fl-slot", w)}>
      &nbsp;
    </span>
  );
}

function PaperLine({
  id,
  active,
  className,
  children,
}: {
  id: string;
  active: string | null;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn("fl-line relative flex justify-between gap-3", className)}
      data-active={active === id ? "" : undefined}
    >
      {children}
    </div>
  );
}

/** The thermal receipt being read. The pencil ring marks the line the model is unsure of. */
function Paper({
  sample,
  active,
  scanKey,
  ring,
}: {
  sample: Sample;
  active: string | null;
  scanKey: number | null;
  ring: boolean;
}) {
  return (
    <div className="fl-paper-shadow">
      <div
        aria-hidden="true"
        className="fl-paper relative overflow-hidden px-4 pt-6 pb-7 text-xs leading-[1.6]"
      >
        {scanKey !== null ? <div className="fl-scan" key={scanKey} /> : null}
        <PaperLine active={active} className="justify-center" id="merchant">
          <span className="text-center text-[13px] font-medium tracking-[0.06em] uppercase">
            {sample.printedMerchant}
          </span>
        </PaperLine>
        <p className="text-center opacity-70">{sample.address}</p>
        <PaperLine active={active} className="mt-2 opacity-80" id="date">
          <span>{sample.isoDate}</span>
          <span>{sample.time}</span>
        </PaperLine>
        <div className="fl-rule my-2" />
        {sample.items.map((item, i) => {
          const low = tier(item.confidence) === "review";
          return (
            <PaperLine active={active} id={`item-${i}`} key={item.name}>
              <span className={cn("truncate", low && "fl-faded")}>{item.printed}</span>
              <span className={cn(low && "fl-faded")}>{amount(item.price)}</span>
              {low && ring ? (
                <svg
                  className="pointer-events-none absolute -inset-x-1.5 -inset-y-1 h-[calc(100%+8px)] w-[calc(100%+12px)] overflow-visible text-destructive"
                  fill="none"
                  preserveAspectRatio="none"
                  viewBox="0 0 100 20"
                >
                  <path
                    className="fl-pencil"
                    d="M6 4C30 0 78 0 96 5c5 4 2 11-10 13C60 21 20 21 5 16-2 12 0 6 14 3"
                    pathLength={1}
                    stroke="currentColor"
                    strokeLinecap="round"
                    strokeWidth="1.4"
                    vectorEffect="non-scaling-stroke"
                  />
                </svg>
              ) : null}
            </PaperLine>
          );
        })}
        <div className="fl-rule my-2" />
        <PaperLine active={active} id="subtotal">
          <span>SUBTOTAL</span>
          <span>{amount(sample.subtotal)}</span>
        </PaperLine>
        <PaperLine active={active} id="tax">
          <span>TAX</span>
          <span>{amount(sample.tax)}</span>
        </PaperLine>
        {sample.tip !== null ? (
          <PaperLine active={active} id="tip">
            <span>TIP</span>
            <span
              className={cn(
                sample.handwrittenTip &&
                  "fl-hand inline-block -rotate-3 text-[17px] leading-none text-(--fl-pen)",
              )}
            >
              {amount(sample.tip)}
            </span>
          </PaperLine>
        ) : null}
        <PaperLine active={active} className="mt-1 text-[13px] font-medium" id="total">
          <span>TOTAL</span>
          <span
            className={cn(
              sample.handwrittenTip &&
                "fl-hand inline-block -rotate-3 text-[18px] leading-none text-(--fl-pen)",
            )}
          >
            {amount(sample.total)}
          </span>
        </PaperLine>
        <p className="mt-3 hidden text-center opacity-70 sm:block">{sample.footer}</p>
        <div className="fl-barcode mx-auto mt-2 hidden h-6 w-3/4 sm:block" />
      </div>
    </div>
  );
}

function Field({
  label,
  shown,
  w,
  mono,
  select,
  span2,
  children,
}: {
  label: string;
  shown: boolean;
  w: string;
  mono?: boolean;
  select?: boolean;
  span2?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("min-w-0", span2 && "col-span-2")}>
      <p className="mb-1 text-xs font-medium text-muted-foreground">{label}</p>
      <div className="flex h-8 items-center justify-between gap-2 rounded-md border border-(--fl-rule-strong) bg-card px-2.5 text-sm">
        <span className={cn("min-w-0", mono && "fl-mono")}>
          <Slot shown={shown} w={w}>
            {children}
          </Slot>
        </span>
        {select ? (
          <ChevronDown aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
        ) : null}
      </div>
    </div>
  );
}

export function HeroDemo() {
  const [sampleId, setSampleId] = useState<SampleId>(DEFAULT);
  // -1 while the scan sweeps, then the number of steps revealed. First paint is the finished read.
  const [step, setStep] = useState(() => stepsFor(byId(DEFAULT)).length);
  const [run, setRun] = useState(0);
  const [session, setSession] = useState<SampleId[]>([DEFAULT]);
  const [landed, setLanded] = useState<SampleId | null>(null);
  const [announce, setAnnounce] = useState("");
  const timers = useRef<number[]>([]);

  const sample = byId(sampleId);
  const steps = stepsFor(sample);
  const done = step >= steps.length;
  const scanning = step < 0;
  const shown = (key: string) => step > steps.indexOf(key);
  const active = !scanning && !done && step > 0 ? steps[step - 1] : null;

  const finish = useCallback((s: Sample) => {
    setStep(stepsFor(s).length);
    setSession((prev) => [s.id, ...prev.filter((id) => id !== s.id)]);
    setLanded(s.id);
    const flagged = s.items.find((item) => tier(item.confidence) === "review");
    setAnnounce(
      `${s.merchant} read: total ${usd(s.total)}, category ${s.category}.${
        flagged ? ` ${flagged.name} is flagged to check.` : ""
      } Row added to the export.`,
    );
  }, []);

  const start = useCallback(
    (id: SampleId) => {
      for (const t of timers.current) window.clearTimeout(t);
      timers.current = [];
      const next = byId(id);
      setSampleId(id);
      setLanded(null);
      setAnnounce("");
      setRun((r) => r + 1);
      if (reducedMotion()) {
        finish(next);
        return;
      }
      setStep(-1);
      const count = stepsFor(next).length;
      for (let i = 0; i <= count; i++) {
        const at = SCAN_MS + i * STEP_MS;
        timers.current.push(window.setTimeout(() => (i === count ? finish(next) : setStep(i)), at));
      }
    },
    [finish],
  );

  // Play the default sample once after hydration; reduced motion keeps the finished read.
  useEffect(() => {
    const pending = timers.current;
    const t = window.setTimeout(() => {
      if (!reducedMotion()) start(DEFAULT);
    }, 900);
    return () => {
      window.clearTimeout(t);
      for (const id of pending) window.clearTimeout(id);
    };
  }, [start]);

  const rows = [
    ...(done ? session : session.filter((id) => id !== sampleId)).map((id) => {
      const s = byId(id);
      return {
        id: s.id as string,
        merchant: s.merchant,
        isoDate: s.isoDate,
        category: s.category,
        total: s.total,
      };
    }),
    ...earlierRows.map((r) => ({ id: r.merchant, ...r })),
  ];
  // While a read runs, its row is held open at the top so the export never changes height.
  const pending = !done;
  const visibleRows = rows.slice(0, pending ? 2 : 3);

  const flagged = sample.items.find((item) => tier(item.confidence) === "review");
  const worthALook = sample.items.find((item) => tier(item.confidence) === "check");
  const padRows = MAX_ITEMS - sample.items.length;

  return (
    <figure aria-label="Sample: a receipt read line by line" className="relative">
      <div className="overflow-hidden rounded-xl border border-(--fl-rule-strong) bg-card shadow-(--fl-shadow)">
        {/* Toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2">
          <div className="flex min-w-0 items-center gap-2">
            <span className="rounded-[4px] bg-foreground px-1.5 py-0.5 text-xs font-semibold tracking-[0.04em] text-background uppercase">
              Sample
            </span>
            <span className="fl-mono truncate text-xs text-muted-foreground">
              {sample.fileName}
            </span>
          </div>
          <div className="flex w-full items-center gap-1 sm:w-auto">
            <div
              aria-label="Sample receipts"
              className="flex flex-1 gap-1 sm:flex-none"
              role="group"
            >
              {samples.map((s) => (
                <button
                  aria-pressed={s.id === sampleId}
                  className={cn(
                    "min-h-11 flex-1 rounded-md px-2.5 text-[13px] font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-9 sm:flex-none",
                    s.id === sampleId
                      ? "bg-(--fl-primary-tint) text-primary"
                      : "text-(--fl-ink-2) hover:bg-muted",
                  )}
                  key={s.id}
                  onClick={() => start(s.id)}
                  type="button"
                >
                  <span className="sm:hidden">{s.shortLabel}</span>
                  <span className="hidden sm:inline">{s.label}</span>
                </button>
              ))}
            </div>
            <button
              className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-1.5 rounded-md px-2.5 text-[13px] font-medium text-(--fl-ink-2) outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring sm:min-h-9"
              onClick={() => start(sampleId)}
              type="button"
            >
              <RotateCcw aria-hidden="true" className="size-3.5" />
              <span className="max-sm:sr-only">Replay</span>
            </button>
          </div>
        </div>

        <div className="grid sm:grid-cols-[minmax(0,224px)_minmax(0,1fr)]">
          {/* The photo */}
          {/* Below sm the paper sits above the record, so its column keeps the tallest sample's height. */}
          <div className="relative border-b border-border bg-muted px-6 pt-5 pb-3 max-sm:min-h-[405px] sm:border-r sm:border-b-0 sm:px-4">
            <div className="mx-auto max-w-[216px] -rotate-[0.8deg]">
              <Paper
                active={active}
                ring={done && Boolean(flagged)}
                sample={sample}
                scanKey={scanning ? run : null}
              />
            </div>
            {/* Margin note, in red pencil; its space is always reserved. */}
            <p
              aria-hidden="true"
              className={cn(
                "fl-hand mt-3 flex min-h-12 items-start gap-1 text-[19px] leading-[1.05] text-destructive transition-opacity duration-500",
                done && flagged ? "opacity-100" : "opacity-0",
              )}
            >
              <svg className="mt-0.5 size-5 shrink-0" fill="none" viewBox="0 0 20 20">
                <path
                  d="M4 17C5 10 9 6 15 4m0 0-4-.5M15 4l-1 4"
                  stroke="currentColor"
                  strokeLinecap="round"
                  strokeWidth="1.4"
                />
              </svg>
              Faded print. Flagged so you check it.
            </p>
          </div>

          {/* The record */}
          <div className="min-w-0 p-4 sm:p-5">
            <div className="flex min-h-6 items-center justify-between gap-3">
              <p className="text-sm font-semibold">Extracted record</p>
              {done ? (
                <span className="inline-flex items-center gap-2">
                  <Confidence score={sample.confidence} />
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Loader2
                    aria-hidden="true"
                    className="size-3.5 animate-spin motion-reduce:animate-none"
                  />
                  {scanning ? "Scanning photo…" : statusText(active)}
                </span>
              )}
            </div>

            <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2.5">
              <Field label="Merchant" shown={shown("merchant")} span2 w="w-40">
                {sample.merchant}
              </Field>
              <Field label="Date" shown={shown("date")} w="w-20">
                {sample.date}
              </Field>
              <Field label="Category" select shown={shown("category")} w="w-16">
                {sample.category}
              </Field>
            </div>

            <table className="mt-4 w-full table-fixed text-[13px]">
              <caption className="sr-only">Line items, with a confidence score for each</caption>
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground">
                  <th className="pb-1.5 font-medium" scope="col">
                    Item
                  </th>
                  <th className="w-8 pb-1.5 text-right font-medium" scope="col">
                    Qty
                  </th>
                  <th className="w-[4.5rem] pb-1.5 text-right font-medium" scope="col">
                    Price
                  </th>
                  <th
                    className="w-[5.5rem] pb-1.5 text-right font-medium sm:w-[9.25rem]"
                    scope="col"
                  >
                    <span className="sr-only">Confidence</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {sample.items.map((item, i) => {
                  const on = shown(`item-${i}`);
                  const low = tier(item.confidence) === "review";
                  return (
                    <tr
                      className={cn(
                        "h-8 border-b border-border",
                        on &&
                          low &&
                          "bg-(--fl-crit-tint) shadow-[inset_2px_0_0_var(--destructive)]",
                      )}
                      key={item.name}
                    >
                      <td className="truncate pr-2 pl-1">
                        <Slot shown={on} w="w-24">
                          <span className={low ? "font-medium" : undefined}>{item.name}</span>
                        </Slot>
                      </td>
                      <td className="fl-mono text-right">
                        <Slot shown={on} w="w-3">
                          {item.qty}
                        </Slot>
                      </td>
                      <td className="fl-mono text-right">
                        <Slot shown={on} w="w-12">
                          {usd(item.price)}
                        </Slot>
                      </td>
                      <td className="pr-1 text-right">
                        <Slot shown={on} w="w-8">
                          <span className="hidden sm:inline">
                            <LineFlag score={item.confidence} />
                          </span>
                          <span className="sm:hidden">
                            <LineFlag score={item.confidence} short />
                          </span>
                        </Slot>
                      </td>
                    </tr>
                  );
                })}
                {Array.from({ length: padRows }, (_, i) => (
                  <tr aria-hidden="true" className="h-8" key={`pad-${i}`}>
                    <td colSpan={4} />
                  </tr>
                ))}
              </tbody>
            </table>

            <dl className="mt-2 grid text-[13px]">
              {(
                [
                  ["Subtotal", "subtotal", sample.subtotal],
                  ["Tax", "tax", sample.tax],
                  ["Tip", "tip", sample.tip],
                ] as const
              ).map(([label, key, value]) => (
                <div className="flex h-6 items-center justify-between text-(--fl-ink-2)" key={key}>
                  <dt>{label}</dt>
                  <dd className="fl-mono">
                    <Slot shown={shown(key)} w="w-12">
                      {value === null ? (
                        <span className="font-sans text-muted-foreground">Not on receipt</span>
                      ) : (
                        usd(value)
                      )}
                    </Slot>
                  </dd>
                </div>
              ))}
              <div className="mt-1 flex h-9 items-center justify-between border-t border-border text-[15px] font-semibold">
                <dt>Total</dt>
                <dd className="fl-mono">
                  <Slot shown={shown("total")} w="w-16">
                    {usd(sample.total)}
                  </Slot>
                </dd>
              </div>
            </dl>

            <p
              className={cn(
                "mt-3 flex min-h-10 items-start gap-1.5 text-xs leading-5",
                done && flagged ? "text-destructive" : "text-(--fl-ink-2)",
              )}
            >
              {done && flagged ? (
                <>
                  <TriangleAlert aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
                  {flagged.name} was hard to read. Check it against the photo.
                </>
              ) : done && worthALook ? (
                <>
                  <CircleCheck
                    aria-hidden="true"
                    className="mt-0.5 size-3.5 shrink-0 text-primary"
                  />
                  Nothing to fix. {worthALook.name} scored {worthALook.confidence}%, so it&apos;s
                  marked worth a look.
                </>
              ) : done ? (
                <>
                  <CircleCheck
                    aria-hidden="true"
                    className="mt-0.5 size-3.5 shrink-0 text-primary"
                  />
                  Every line read with high confidence. Ready to export.
                </>
              ) : null}
            </p>
          </div>
        </div>

        {/* The export */}
        <div className="border-t border-border bg-background">
          <p className="fl-mono px-4 pt-2.5 pb-1 text-xs text-muted-foreground">
            <span className="text-foreground">receipts.csv</span> ·{" "}
            {rows.length + (pending ? 1 : 0)} rows
          </p>
          <table className="fl-mono w-full table-fixed text-xs">
            <caption className="sr-only">Rows in the sample export</caption>
            <thead>
              <tr className="text-left text-muted-foreground">
                <th className="w-[6.75rem] py-1.5 pl-4 font-normal" scope="col">
                  receipt_date
                </th>
                <th className="py-1.5 pl-2 font-normal" scope="col">
                  merchant
                </th>
                <th className="hidden w-24 py-1.5 pl-2 font-normal sm:table-cell" scope="col">
                  category
                </th>
                <th className="w-20 py-1.5 pr-4 pl-2 text-right font-normal" scope="col">
                  total
                </th>
              </tr>
            </thead>
            <tbody>
              {pending ? (
                <tr aria-hidden="true" className="border-t border-border">
                  <td className="py-1.5 pl-4">
                    <span className="fl-slot w-20" />
                  </td>
                  <td className="py-1.5 pl-2">
                    <span className="fl-slot w-28" />
                  </td>
                  <td className="hidden py-1.5 pl-2 sm:table-cell">
                    <span className="fl-slot w-14" />
                  </td>
                  <td className="py-1.5 pr-4 pl-2 text-right">
                    <span className="fl-slot w-12" />
                  </td>
                </tr>
              ) : null}
              {visibleRows.map((r) => (
                <tr
                  className={cn("border-t border-border", r.id === landed && "fl-land")}
                  key={r.id}
                >
                  <td className="py-1.5 pl-4 whitespace-nowrap">{r.isoDate}</td>
                  <td className="truncate py-1.5 pl-2">{r.merchant}</td>
                  <td className="hidden py-1.5 pl-2 sm:table-cell">{r.category}</td>
                  <td className="py-1.5 pr-4 pl-2 text-right">{amount(r.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <p aria-live="polite" className="sr-only">
        {announce}
      </p>
    </figure>
  );
}
