"use client";

import { cn } from "@receipt-ocr/ui/lib/utils";
import { RotateCcw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { confidenceLevel, formatConfidence, formatDate, formatMoney } from "@/lib/format";
import { type Sample, samples, stepsFor } from "./fixtures";
import { focusRing } from "./primitives";

type SampleId = Sample["id"];

const SCAN_MS = 1200;
const STEP_MS = 240;

const byId = (id: SampleId) => samples.find((s) => s.id === id) ?? samples[0];
const usd = (value: number) => formatMoney(value, "USD");
const isLow = (confidence: number) => confidenceLevel(confidence) === "review";
// "row" is E's export step; this demo stops at the read.
const readSteps = (sample: Sample) => stepsFor(sample).filter((key) => key !== "row");

const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function Slot({ shown, w, children }: { shown: boolean; w: string; children: React.ReactNode }) {
  return shown ? (
    <span className="pp-in">{children}</span>
  ) : (
    <span aria-hidden className={cn("pp-slot", w)}>
      &nbsp;
    </span>
  );
}

/** The paper, drawn in HTML. Only the background is tilted, so the print stays crisp. */
function Paper({
  sample,
  reading,
  scanning,
  run,
}: {
  sample: Sample;
  reading: string | null;
  scanning: boolean;
  run: number;
}) {
  const [y, m, d] = sample.receiptDate.split("-");
  const line = (key: string) => cn("flex justify-between gap-3", reading === key && "pp-reading");
  const flagged = sample.items.filter((item) => isLow(item.confidence)).map((item) => item.name);
  return (
    <div
      aria-label={`Photo of a paper receipt from ${sample.merchant}, total ${usd(sample.total)}.${
        flagged.length ? ` The line for ${flagged.join(", ")} is smudged and hard to read.` : ""
      }`}
      className="pp-lift relative"
      role="img"
    >
      <div aria-hidden className="pp-thermal absolute inset-0 -rotate-1" />
      <div
        aria-hidden
        className={cn(
          "pp-mono relative overflow-hidden px-4 pt-5 pb-8 text-[0.75rem] leading-[1.6] text-[#2a2620] uppercase",
          scanning && "pp-scanning",
        )}
        key={run}
      >
        <div className="pp-scan" />
        <p
          className={cn(
            line("merchant"),
            "justify-center text-[0.85rem] font-medium tracking-wide",
          )}
        >
          {sample.merchant}
        </p>
        {sample.address.map((text) => (
          <p className="text-center text-[#5c5347] max-sm:hidden" key={text}>
            {text}
          </p>
        ))}
        <p className={cn(line("date"), "mt-2")}>
          <span>
            {m}/{d}/{y}
          </span>
          <span>{sample.time}</span>
        </p>
        <div className="pp-dashed my-2" />
        {sample.items.map((item, i) => (
          <p
            className={cn(line(`item-${i}`), isLow(item.confidence) && "pp-smudged")}
            key={item.name}
          >
            <span className="truncate">{item.printed}</span>
            <span>{item.totalPrice.toFixed(2)}</span>
          </p>
        ))}
        <div className="pp-dashed my-2" />
        <p className={line("subtotal")}>
          <span>Subtotal</span>
          <span>{sample.subtotal.toFixed(2)}</span>
        </p>
        <p className={line("tax")}>
          <span>Tax</span>
          <span>{sample.tax.toFixed(2)}</span>
        </p>
        {sample.tip !== null && (
          <p className={line("tip")}>
            <span>Tip</span>
            <span
              className={cn(
                sample.handwrittenTip &&
                  "pp-display pp-wonk text-[1.05rem] leading-none text-[#1d3a8a] normal-case",
              )}
            >
              {sample.tip.toFixed(2)}
            </span>
          </p>
        )}
        <p className={cn(line("total"), "mt-1 text-[0.85rem] font-medium")}>
          <span>Total</span>
          <span>{sample.total.toFixed(2)}</span>
        </p>
        <div className="pp-barcode mx-auto mt-4 h-7 w-4/5 opacity-85" />
        <p className="mt-2 text-center text-[#5c5347]">{sample.footer}</p>
      </div>
    </div>
  );
}

export function HeroDemo() {
  const [sampleId, setSampleId] = useState<SampleId>(samples[0].id);
  // Steps revealed so far. First paint (and reduced motion) is the finished read.
  const [step, setStep] = useState(() => readSteps(samples[0]).length);
  const [scanning, setScanning] = useState(false);
  const [run, setRun] = useState(0);
  const [announce, setAnnounce] = useState("");
  const timers = useRef<number[]>([]);

  const sample = byId(sampleId);
  const steps = readSteps(sample);
  const done = !scanning && step >= steps.length;
  const shown = (key: string) => !scanning && step > steps.indexOf(key);
  const reading = !scanning && !done && step > 0 ? steps[step - 1] : null;
  const flagged = sample.items.filter((item) => isLow(item.confidence));

  const start = useCallback((id: SampleId) => {
    for (const t of timers.current) window.clearTimeout(t);
    timers.current = [];
    const next = byId(id);
    const count = readSteps(next).length;
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

  const status = scanning
    ? "Reading the photo…"
    : done
      ? `Read · ${formatConfidence(sample.confidence)} sure overall`
      : "Filling in the fields…";

  return (
    <div>
      <div className="flex items-center justify-between gap-x-2">
        <div aria-label="Sample receipts" className="flex gap-1" role="group">
          {samples.map((s) => (
            <button
              aria-pressed={s.id === sampleId}
              className={cn(
                "h-11 rounded-full px-3 text-sm font-medium whitespace-nowrap transition-colors sm:px-3.5",
                s.id === sampleId
                  ? "bg-foreground text-background"
                  : "text-muted-foreground hover:bg-secondary hover:text-foreground",
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
            "inline-flex h-11 min-w-11 items-center justify-center gap-2 rounded-full px-3 text-sm font-medium text-muted-foreground hover:bg-secondary hover:text-foreground max-sm:px-0",
            focusRing,
          )}
          onClick={() => start(sampleId)}
          type="button"
        >
          <RotateCcw aria-hidden className="size-4" />
          <span className="max-sm:sr-only">Replay</span>
        </button>
      </div>

      <div className="mt-3 grid gap-4 sm:mt-4 sm:grid-cols-[13.5rem_minmax(0,1fr)] sm:grid-rows-[auto_1fr] sm:gap-x-5">
        <div className="max-sm:mx-auto max-sm:max-h-[9.5rem] max-sm:w-[15rem] max-sm:overflow-hidden max-sm:[mask-image:linear-gradient(#000_75%,transparent)] max-sm:pt-1">
          <Paper reading={reading} run={run} sample={sample} scanning={scanning} />
        </div>

        <figure className="pp-sheet min-w-0 rounded-xl p-4 max-sm:-mt-3 sm:col-start-2 sm:row-span-2 sm:row-start-1 sm:self-start sm:p-5">
          <figcaption className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <span className="pp-mono text-[0.75rem] font-medium tracking-[0.14em] text-muted-foreground uppercase">
              Sample · what receiptOCR read
            </span>
            <span className="text-xs text-muted-foreground">{status}</span>
          </figcaption>

          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2.5 border-y border-border py-3 text-sm">
            <div className="col-span-2">
              <dt className="text-xs text-muted-foreground">Merchant</dt>
              <dd className="pp-display mt-0.5 text-lg leading-snug">
                <Slot shown={shown("merchant")} w="w-40">
                  {sample.merchant}
                </Slot>
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Date</dt>
              <dd className="mt-0.5 font-medium">
                <Slot shown={shown("date")} w="w-24">
                  {formatDate(sample.receiptDate)}
                </Slot>
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Category</dt>
              <dd className="mt-0.5">
                <Slot shown={shown("category")} w="w-20">
                  <span className="inline-flex rounded-full bg-secondary px-2 py-0.5 text-xs font-medium">
                    {sample.category}
                  </span>
                </Slot>
              </dd>
            </div>
          </dl>

          <table className="mt-2 w-full text-sm">
            <caption className="sr-only">Line items, with how sure the read is for each</caption>
            <thead>
              <tr className="text-xs text-muted-foreground">
                <th className="py-1 text-left font-normal" scope="col">
                  Item
                </th>
                <th className="py-1 text-right font-normal" scope="col">
                  Amount
                </th>
                <th className="w-12 py-1 text-right font-normal" scope="col">
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
                    <td className={cn("py-1.5 pr-2", low && "h-[3.1rem]")}>
                      <Slot shown={on} w="w-28">
                        <span className={cn(low && "pp-highlight -mx-1 px-1 font-medium")}>
                          {item.name}
                        </span>
                        {item.quantity > 1 && (
                          <span className="text-muted-foreground"> ×{item.quantity}</span>
                        )}
                        {low && (
                          <span className="mt-0.5 block text-xs font-semibold text-[var(--pp-accent)]">
                            Check this line
                          </span>
                        )}
                      </Slot>
                    </td>
                    <td className="pp-mono py-1.5 text-right">
                      <Slot shown={on} w="w-12">
                        {usd(item.totalPrice)}
                      </Slot>
                    </td>
                    <td className="pp-mono py-1.5 text-right text-xs text-muted-foreground">
                      <Slot shown={on} w="w-7">
                        {formatConfidence(item.confidence)}
                        {low && <span className="sr-only"> (low confidence)</span>}
                      </Slot>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <dl className="mt-1 grid gap-0.5 border-t border-border pt-2 text-sm">
            {(
              [
                ["Subtotal", "subtotal", sample.subtotal],
                ["Tax", "tax", sample.tax],
                ...(sample.tip === null ? [] : ([["Tip", "tip", sample.tip]] as const)),
              ] as const
            ).map(([label, key, value]) => (
              <div className="flex justify-between text-muted-foreground" key={key}>
                <dt>{label}</dt>
                <dd className="pp-mono">
                  <Slot shown={shown(key)} w="w-12">
                    {usd(value)}
                  </Slot>
                </dd>
              </div>
            ))}
            <div className="mt-0.5 flex justify-between font-semibold">
              <dt>Total</dt>
              <dd className="pp-mono">
                <Slot shown={shown("total")} w="w-16">
                  {usd(sample.total)}
                </Slot>
              </dd>
            </div>
          </dl>
        </figure>

        <p
          aria-hidden={!done || flagged.length === 0}
          className={cn(
            "pp-display pp-wonk flex min-h-12 items-start gap-2 text-[1.05rem] leading-snug text-[var(--pp-accent)] transition-opacity duration-300 sm:col-start-1 sm:row-start-2 sm:pt-2",
            done && flagged.length ? "opacity-100" : "opacity-0",
          )}
        >
          <span>
            {flagged.length
              ? `The print was smudged, so it's only ${formatConfidence(flagged[0].confidence)} sure. Worth a look.`
              : "Nothing to check on this one."}
          </span>
          <svg
            aria-hidden
            className="mt-0.5 hidden h-6 w-10 shrink-0 sm:block"
            fill="none"
            viewBox="0 0 40 24"
          >
            <path
              d="M2 18c10 1 20-3 30-12m0 0-7 0m7 0-1 7"
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="1.8"
            />
          </svg>
        </p>
      </div>
      <p aria-live="polite" className="sr-only">
        {announce}
      </p>
    </div>
  );
}
