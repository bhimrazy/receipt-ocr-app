"use client";

import { cn } from "@receipt-ocr/ui/lib/utils";
import { FileImage, RotateCcw, TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { ConfidenceBadge } from "@/components/receipt-status";
import { confidenceLevel, formatConfidence, formatDate, formatMoney } from "@/lib/format";
import { earlierRows, type Sample, samples, stepsFor } from "./fixtures";
import { focusRing } from "./primitives";

type SampleId = Sample["id"];

const SCAN_MS = 1200;
const STEP_MS = 240;

const byId = (id: SampleId) => samples.find((s) => s.id === id) ?? samples[0];
const usd = (value: number) => formatMoney(value, "USD");
const isLow = (confidence: number) => confidenceLevel(confidence) === "review";
const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function Slot({ shown, w, children }: { shown: boolean; w: string; children: React.ReactNode }) {
  return shown ? (
    <span className="fc-in">{children}</span>
  ) : (
    <span aria-hidden className={cn("fc-slot", w)}>
      &nbsp;
    </span>
  );
}

/** The receipt photo, drawn in HTML. */
function Paper({
  sample,
  reading,
  scanning,
  done,
  run,
}: {
  sample: Sample;
  reading: string | null;
  scanning: boolean;
  done: boolean;
  run: number;
}) {
  const [y, m, d] = sample.receiptDate.split("-");
  const line = (key: string) =>
    cn("flex justify-between gap-3 rounded-[2px]", reading === key && "fc-reading");
  const flagged = sample.items.filter((item) => isLow(item.confidence)).map((item) => item.name);
  return (
    <div
      aria-label={`Photo of a paper receipt from ${sample.merchant}, total ${usd(sample.total)}.${
        flagged.length ? ` The line for ${flagged.join(", ")} is faded and hard to read.` : ""
      }`}
      className="w-full drop-shadow-[0_12px_24px_rgb(0_0_0/0.5)]"
      role="img"
    >
      <div
        aria-hidden
        className={cn(
          "fc-paper relative overflow-hidden rounded-t-md border-x border-t border-white/10 px-4 pt-4 font-mono text-[0.6875rem] leading-[1.7] text-foreground/85 uppercase",
          scanning && "fc-scanning",
        )}
        key={run}
      >
        <div className="fc-scan" />
        <p
          className={cn(
            line("merchant"),
            "justify-center text-[0.8rem] font-semibold tracking-wide text-foreground",
          )}
        >
          {sample.merchant}
        </p>
        <p className="text-center text-muted-foreground max-sm:hidden">{sample.address}</p>
        <p className={cn(line("date"), "mt-2")}>
          <span>
            {m}/{d}/{y}
          </span>
          <span>{sample.time}</span>
        </p>
        <div className="fc-dashed my-2" />
        {sample.items.map((item, i) => (
          <p
            className={cn(
              line(`item-${i}`),
              isLow(item.confidence) && "fc-smudged",
              done && isLow(item.confidence) && "fc-flagged",
            )}
            key={item.name}
          >
            <span className="truncate">
              {item.printed}
              {item.quantity > 1 && ` x${item.quantity}`}
            </span>
            <span className="fc-num">{item.totalPrice.toFixed(2)}</span>
          </p>
        ))}
        {/* Below sm the photo is cropped here, after the line items, to keep the demo short. */}
        <div className="fc-dashed my-2 max-sm:hidden" />
        <div className="max-sm:hidden">
          <p className={line("subtotal")}>
            <span>Subtotal</span>
            <span className="fc-num">{sample.subtotal.toFixed(2)}</span>
          </p>
          <p className={line("tax")}>
            <span>Tax</span>
            <span className="fc-num">{sample.tax.toFixed(2)}</span>
          </p>
          {sample.tip !== null && (
            <p className={line("tip")}>
              <span>Tip</span>
              <span className="fc-num">{sample.tip.toFixed(2)}</span>
            </p>
          )}
          <p className={cn(line("total"), "mt-1 text-[0.8rem] font-semibold text-foreground")}>
            <span>Total</span>
            <span className="fc-num">{sample.total.toFixed(2)}</span>
          </p>
        </div>
      </div>
    </div>
  );
}

const csvCell = "py-2 pl-3 first:pl-4 last:pr-4 sm:first:pl-5 sm:last:pr-5";

/** The export the read lands in. Always two rows tall, so finishing a read shifts nothing. */
function CsvStrip({ sample, done, run }: { sample: Sample; done: boolean; run: number }) {
  const earlier = earlierRows[0];
  return (
    <div className="border-t border-border bg-background/50">
      <p className="flex items-baseline justify-between gap-3 px-4 pt-3 font-mono text-xs text-muted-foreground sm:px-5">
        <span>
          <span className="text-foreground">receipts.csv</span>
        </span>
        <span>{done ? "1 row added" : "Waiting for the read"}</span>
      </p>
      <table className="w-full table-fixed font-mono text-xs">
        <caption className="sr-only">The sample receipt as a row in the CSV export</caption>
        <thead>
          <tr className="text-left text-muted-foreground">
            <th className={cn(csvCell, "font-normal")} scope="col">
              merchant
            </th>
            <th className={cn(csvCell, "w-[6.5rem] font-normal")} scope="col">
              receipt_date
            </th>
            <th className={cn(csvCell, "hidden w-24 font-normal sm:table-cell")} scope="col">
              category
            </th>
            <th className={cn(csvCell, "w-[4.5rem] text-right font-normal")} scope="col">
              total
            </th>
          </tr>
        </thead>
        <tbody>
          <tr
            className={cn("border-t border-border", done && "fc-land")}
            key={`${sample.id}-${run}`}
          >
            <td className={cn(csvCell, "truncate text-foreground")}>
              <Slot shown={done} w="w-24">
                {sample.merchant}
              </Slot>
            </td>
            <td className={csvCell}>
              <Slot shown={done} w="w-20">
                {sample.receiptDate}
              </Slot>
            </td>
            <td className={cn(csvCell, "hidden sm:table-cell")}>
              <Slot shown={done} w="w-14">
                {sample.category}
              </Slot>
            </td>
            <td className={cn(csvCell, "fc-num text-right text-foreground")}>
              <Slot shown={done} w="w-10">
                {sample.total.toFixed(2)}
              </Slot>
            </td>
          </tr>
          <tr className="border-t border-border text-muted-foreground">
            <td className={cn(csvCell, "truncate")}>{earlier.merchant}</td>
            <td className={csvCell}>{earlier.receiptDate}</td>
            <td className={cn(csvCell, "hidden sm:table-cell")}>{earlier.category}</td>
            <td className={cn(csvCell, "fc-num text-right")}>{earlier.total.toFixed(2)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

export function HeroDemo() {
  const [sampleId, setSampleId] = useState<SampleId>(samples[0].id);
  // Steps revealed so far. First paint (and reduced motion) is the finished read.
  const [step, setStep] = useState(() => stepsFor(samples[0]).length);
  const [scanning, setScanning] = useState(false);
  const [run, setRun] = useState(0);
  const [announce, setAnnounce] = useState("");
  const timers = useRef<number[]>([]);

  const sample = byId(sampleId);
  const steps = stepsFor(sample);
  const done = !scanning && step >= steps.length;
  const shown = (key: string) => !scanning && step > steps.indexOf(key);
  const reading = !scanning && !done && step > 0 ? steps[step - 1] : null;

  const start = useCallback((id: SampleId) => {
    for (const t of timers.current) window.clearTimeout(t);
    timers.current = [];
    const next = byId(id);
    const count = stepsFor(next).length;
    const finish = () => {
      setScanning(false);
      setStep(count);
      const low = next.items.filter((item) => isLow(item.confidence));
      setAnnounce(
        `Read ${next.merchant}: total ${usd(next.total)}, category ${next.category}.${
          low.length ? ` Check this line: ${low.map((item) => item.name).join(", ")}.` : ""
        }`,
      );
    };
    setSampleId(id);
    setAnnounce("");
    setRun((r) => r + 1);
    if (reducedMotion()) {
      finish();
      return;
    }
    setScanning(true);
    setStep(0);
    const later = (ms: number, fn: () => void) => timers.current.push(window.setTimeout(fn, ms));
    later(SCAN_MS, () => setScanning(false));
    for (let i = 1; i <= count; i++) later(SCAN_MS + i * STEP_MS, () => setStep(i));
    later(SCAN_MS + (count + 1) * STEP_MS, finish);
  }, []);

  // Read the default sample once after hydration; reduced motion keeps the finished state.
  useEffect(() => {
    const pending = timers.current;
    const t = window.setTimeout(() => {
      if (!reducedMotion()) start(samples[0].id);
    }, 900);
    return () => {
      window.clearTimeout(t);
      for (const id of pending) window.clearTimeout(id);
    };
  }, [start]);

  const status = scanning ? "Reading the photo…" : done ? "Done" : "Filling in the fields…";
  const totals = [
    ["Subtotal", "subtotal", sample.subtotal],
    ["Tax", "tax", sample.tax],
    ["Tip", "tip", sample.tip],
  ] as const;

  return (
    <div className="relative isolate">
      <div aria-hidden className="fc-glow absolute -inset-x-16 -inset-y-10 -z-10" />
      <figure
        aria-label="Sample: a receipt read by receiptOCR"
        className="card-sheen relative overflow-hidden rounded-2xl border border-white/10 bg-card/85 shadow-2xl shadow-black/60 backdrop-blur-xl"
      >
        {/* Window chrome */}
        <div className="flex items-center gap-2 border-b border-border bg-secondary/50 px-4 py-2.5">
          <span aria-hidden className="size-2.5 shrink-0 rounded-full bg-foreground/15" />
          <span aria-hidden className="size-2.5 shrink-0 rounded-full bg-foreground/15" />
          <span aria-hidden className="size-2.5 shrink-0 rounded-full bg-foreground/15" />
          <span className="ml-2 min-w-0 truncate font-mono text-xs text-muted-foreground">
            receiptocr.app/receipts/{sample.slug}
          </span>
          <span className="ml-auto shrink-0 font-mono text-xs text-muted-foreground">Sample</span>
        </div>

        {/* Sample picker */}
        <div className="flex items-center justify-between gap-2 border-b border-border px-2 py-1.5 sm:px-3">
          <div aria-label="Sample receipts" className="flex gap-1" role="group">
            {samples.map((s) => (
              <button
                aria-pressed={s.id === sampleId}
                className={cn(
                  "h-11 rounded-full px-3.5 text-sm font-medium whitespace-nowrap transition-colors",
                  s.id === sampleId
                    ? "bg-primary/12 text-primary"
                    : "text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground",
                  focusRing,
                )}
                key={s.id}
                onClick={() => start(s.id)}
                type="button"
              >
                {s.label}
              </button>
            ))}
          </div>
          <button
            className={cn(
              "inline-flex h-11 min-w-11 items-center justify-center gap-2 rounded-full px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground max-sm:px-0",
              focusRing,
            )}
            onClick={() => start(sampleId)}
            type="button"
          >
            <RotateCcw aria-hidden className="size-4" />
            <span className="max-sm:sr-only">Replay</span>
          </button>
        </div>

        <div className="grid sm:grid-cols-[14rem_minmax(0,1fr)]">
          {/* The photo */}
          <div className="flex flex-col items-center gap-3 border-b border-border bg-background/40 px-5 pt-5 pb-4 max-sm:px-10 sm:border-r sm:border-b-0">
            <Paper done={done} reading={reading} run={run} sample={sample} scanning={scanning} />
            <span className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1 font-mono text-[0.6875rem] text-muted-foreground">
              <FileImage aria-hidden className="size-3 shrink-0" />
              <span className="truncate">{sample.fileName}</span>
            </span>
          </div>

          {/* What was read */}
          <div className="min-w-0 p-4 sm:p-5">
            <div className="flex min-h-6 items-center justify-between gap-3">
              <p className="text-sm font-medium">Extracted data</p>
              {done ? (
                <ConfidenceBadge value={sample.confidence} />
              ) : (
                <span className="font-mono text-xs text-muted-foreground">{status}</span>
              )}
            </div>

            <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 border-y border-border py-3 text-sm">
              <div className="col-span-2">
                <dt className="text-xs text-muted-foreground">Merchant</dt>
                <dd className="mt-0.5 text-base font-semibold">
                  <Slot shown={shown("merchant")} w="w-40">
                    {sample.merchant}
                  </Slot>
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Date</dt>
                <dd className="mt-0.5 font-mono">
                  <Slot shown={shown("date")} w="w-24">
                    {formatDate(sample.receiptDate)}
                  </Slot>
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Category</dt>
                <dd className="mt-0.5">
                  <Slot shown={shown("category")} w="w-20">
                    <span className="inline-flex rounded-full border border-border bg-secondary px-2 py-0.5 text-xs font-medium">
                      {sample.category}
                    </span>
                  </Slot>
                </dd>
              </div>
            </dl>

            <table className="mt-2 w-full table-fixed text-sm">
              <caption className="sr-only">Line items, with how sure the read is for each</caption>
              <thead>
                <tr className="text-xs text-muted-foreground">
                  <th className="py-1.5 text-left font-normal" scope="col">
                    Item
                  </th>
                  <th className="w-9 py-1.5 text-right font-normal" scope="col">
                    Qty
                  </th>
                  <th className="w-[4.75rem] py-1.5 text-right font-normal" scope="col">
                    Amount
                  </th>
                  <th className="w-12 py-1.5 text-right font-normal" scope="col">
                    Sure
                  </th>
                </tr>
              </thead>
              <tbody>
                {sample.items.map((item, i) => {
                  const on = shown(`item-${i}`);
                  const low = isLow(item.confidence);
                  return (
                    <tr className="border-t border-border/70 align-top" key={item.name}>
                      <td className={cn("truncate py-1.5 pr-2", low && "h-[3.25rem]")}>
                        <Slot shown={on} w="w-28">
                          {item.name}
                          {low && (
                            <span
                              className={cn(
                                "mt-0.5 flex items-center gap-1 text-xs font-medium text-warning transition-opacity duration-300",
                                done ? "opacity-100" : "opacity-0",
                              )}
                            >
                              <TriangleAlert aria-hidden className="size-3" />
                              Check this line
                            </span>
                          )}
                        </Slot>
                      </td>
                      <td className="fc-num py-1.5 text-right font-mono text-muted-foreground">
                        <Slot shown={on} w="w-4">
                          {item.quantity}
                        </Slot>
                      </td>
                      <td className="fc-num py-1.5 text-right font-mono">
                        <Slot shown={on} w="w-12">
                          {usd(item.totalPrice)}
                        </Slot>
                      </td>
                      <td
                        className={cn(
                          "fc-num py-1.5 text-right font-mono text-xs leading-5",
                          low ? "font-semibold text-warning" : "text-muted-foreground",
                        )}
                      >
                        <Slot shown={on} w="w-7">
                          {formatConfidence(item.confidence)}
                          {low && <span className="sr-only"> (low, check this line)</span>}
                        </Slot>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            <dl className="mt-1 grid gap-1 border-t border-border pt-2.5 text-sm">
              {totals.map(([label, key, value]) => (
                <div className="flex justify-between text-muted-foreground" key={key}>
                  <dt>{label}</dt>
                  <dd className={cn(value !== null && "fc-num font-mono")}>
                    {/* A blank field stays blank: no tip on the paper means none is guessed. */}
                    <Slot shown={shown(value === null ? "tax" : key)} w="w-12">
                      {value === null ? "Not on receipt" : usd(value)}
                    </Slot>
                  </dd>
                </div>
              ))}
              <div className="mt-0.5 flex justify-between font-semibold">
                <dt>Total</dt>
                <dd className="fc-num font-mono text-primary">
                  <Slot shown={shown("total")} w="w-16">
                    {usd(sample.total)}
                  </Slot>
                </dd>
              </div>
            </dl>
          </div>
        </div>

        <CsvStrip done={done} run={run} sample={sample} />
      </figure>
      <p aria-live="polite" className="sr-only">
        {announce}
      </p>
    </div>
  );
}
