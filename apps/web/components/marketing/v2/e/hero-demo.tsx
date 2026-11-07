"use client";

import { Button } from "@receipt-ocr/ui/components/button";
import { cn } from "@receipt-ocr/ui/lib/utils";
import { CircleCheck, Download, Loader2, RotateCcw, TriangleAlert, Upload } from "lucide-react";
import Link from "next/link";
import { type DragEvent, useCallback, useEffect, useRef, useState } from "react";
import { ConfidenceBadge } from "@/components/receipt-status";
import { confidenceLevel, formatConfidence, formatDate, formatMoney } from "@/lib/format";
import { earlierRows, type Sample, samples, stepsFor } from "./fixtures";
import { ReceiptPaper } from "./receipt-paper";

type SampleId = Sample["id"];

const SCAN_MS = 1300;
const STEP_MS = 300;

const byId = (id: SampleId) => samples.find((s) => s.id === id) ?? samples[0];
const usd = (value: number | null) => (value === null ? null : formatMoney(value, "USD"));
const plain = (value: number | null) => (value === null ? "" : value.toFixed(2));

const prefersReducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function statusText(key: string | undefined) {
  if (!key) return "Scanning…";
  if (key.startsWith("item-")) return "Scanning line items…";
  if (key === "category" || key === "row") return "Categorising…";
  return "Scanning totals…";
}

/** Grey bar holding a value's space until it is read, so nothing shifts. `w` sizes the bar. */
function Slot({ shown, w, children }: { shown: boolean; w: string; children: React.ReactNode }) {
  return shown ? (
    <span className="e-in">{children}</span>
  ) : (
    <span aria-hidden="true" className={cn("e-slot", w)}>
      &nbsp;
    </span>
  );
}

function toCsv(rows: Array<(typeof earlierRows)[number] | Sample>) {
  const header = "merchant,receipt_date,category,currency,tax,tip,total,confidence";
  const quote = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const lines = rows.map((r) =>
    [
      quote(r.merchant),
      r.receiptDate,
      r.category,
      "USD",
      plain(r.tax),
      plain(r.tip),
      plain(r.total),
      "confidence" in r ? r.confidence.toFixed(2) : "",
    ].join(","),
  );
  return [header, ...lines].join("\n");
}

export function HeroDemo() {
  const [sampleId, setSampleId] = useState<SampleId>("coffee");
  // -1 while scanning, then the number of steps revealed. First paint is the finished state.
  const [step, setStep] = useState(() => stepsFor(byId("coffee")).length);
  const [run, setRun] = useState(0);
  const [session, setSession] = useState<SampleId[]>(["coffee"]);
  const [landed, setLanded] = useState<SampleId | null>(null);
  const [dragging, setDragging] = useState(false);
  const [dropped, setDropped] = useState<string | null>(null);
  const [announce, setAnnounce] = useState("");
  const timers = useRef<number[]>([]);

  const sample = byId(sampleId);
  const steps = stepsFor(sample);
  const final = steps.length;
  const done = step >= final;
  const scanning = step < 0;
  const shown = (key: string) => step > steps.indexOf(key);
  const active = !scanning && !done && step > 0 ? steps[step - 1] : null;

  const finish = useCallback((s: Sample) => {
    setStep(stepsFor(s).length);
    setSession((prev) => [s.id, ...prev.filter((id) => id !== s.id)]);
    setLanded(s.id);
    setAnnounce(
      `${s.merchant} scanned: total ${usd(s.total)}, category ${s.category}. Row added to the export.`,
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
      if (prefersReducedMotion()) {
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

  // Play the default sample once after hydration; reduced motion keeps the finished state.
  useEffect(() => {
    const pending = timers.current;
    const t = window.setTimeout(() => {
      if (!prefersReducedMotion()) start("coffee");
    }, 700);
    return () => {
      window.clearTimeout(t);
      for (const id of pending) window.clearTimeout(id);
    };
  }, [start]);

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    // The file is never opened or sent anywhere: only its name is shown.
    const name = event.dataTransfer.files[0]?.name ?? "Your file";
    setDropped(name);
    const index = samples.findIndex((s) => s.id === sampleId);
    start(samples[(index + 1) % samples.length].id);
  };

  const sessionRows = (done ? session : session.filter((id) => id !== sampleId)).map(byId);
  const rows = [...sessionRows, ...earlierRows];

  const download = () => {
    const url = URL.createObjectURL(new Blob([toCsv(rows)], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "receiptocr-sample.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const needsCheck = sample.items.filter((item) => confidenceLevel(item.confidence) === "review");

  return (
    <div className="relative">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <p className="flex items-center gap-2">
          <span aria-hidden="true" className="e-live-dot" />
          <span>
            <span className="font-medium text-foreground">Sample receipt</span> · runs in your
            browser, nothing is uploaded
          </span>
        </p>
        <p className="hidden items-center gap-1.5 lg:flex">
          <Upload aria-hidden="true" className="size-3.5" />
          Or drop any photo on it
        </p>
      </div>

      <div
        className="e-window relative overflow-hidden rounded-2xl border border-border bg-card"
        onDragEnter={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
        }}
        onDragOver={(e) => e.preventDefault()}
        onDrop={onDrop}
      >
        {/* Toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2.5 sm:px-4">
          <div
            aria-label="Sample receipts"
            className="flex w-full gap-1 rounded-full bg-secondary p-1 sm:w-auto"
            role="group"
          >
            {samples.map((s) => (
              <button
                aria-pressed={s.id === sampleId}
                className={cn(
                  "h-11 flex-1 rounded-full px-3.5 text-sm font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring sm:h-9 sm:flex-none",
                  s.id === sampleId
                    ? "bg-card text-foreground shadow-sm ring-1 ring-border"
                    : "text-muted-foreground hover:text-foreground",
                )}
                key={s.id}
                onClick={() => start(s.id)}
                type="button"
              >
                {s.label}
              </button>
            ))}
          </div>
          <div className="flex w-full items-center justify-between gap-2 sm:w-auto">
            <span className="font-mono text-xs text-muted-foreground sm:hidden">
              {sample.fileName}
            </span>
            <Button onClick={() => start(sampleId)} size="sm" type="button" variant="ghost">
              <RotateCcw aria-hidden="true" />
              Replay
            </Button>
          </div>
        </div>

        <div className="grid md:grid-cols-[minmax(0,15.5rem)_minmax(0,1fr)]">
          {/* The photo */}
          <div className="e-stage relative flex items-start justify-center overflow-hidden border-b border-border px-6 pt-6 pb-4 md:border-r md:border-b-0">
            <div className="relative w-full max-w-[13.5rem] -rotate-[1.2deg] max-md:[zoom:0.8]">
              <ReceiptPaper active={active} sample={sample} scanKey={scanning ? run : null} />
            </div>
            <span className="absolute bottom-2 left-3 hidden font-mono text-[11px] text-muted-foreground md:block">
              {sample.fileName}
            </span>
          </div>

          {/* What was read */}
          <div className="min-w-0 p-4 sm:p-5 md:min-h-[29.25rem]">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-semibold">Extracted data</p>
              {done ? (
                <span className="inline-flex items-center gap-1.5 text-xs font-medium text-foreground">
                  <CircleCheck aria-hidden="true" className="size-3.5 text-primary" />
                  Done
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Loader2 aria-hidden="true" className="size-3.5 animate-spin" />
                  {scanning ? "Scanning photo…" : statusText(active ?? undefined)}
                </span>
              )}
            </div>

            <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2.5 rounded-xl bg-secondary/60 px-3 py-2.5 text-sm">
              <div className="min-w-0">
                <dt className="text-xs text-muted-foreground">Merchant</dt>
                <dd className="mt-0.5 truncate font-medium">
                  <Slot w="w-28" shown={shown("merchant")}>
                    {sample.merchant}
                  </Slot>
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Date</dt>
                <dd className="mt-0.5 font-mono tabular-nums">
                  <Slot w="w-20" shown={shown("date")}>
                    {formatDate(sample.receiptDate)}
                  </Slot>
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Category</dt>
                <dd className="mt-0.5">
                  <Slot w="w-16" shown={shown("category")}>
                    <span className="inline-flex rounded-full border border-border bg-card px-2 py-0.5 text-xs font-medium">
                      {sample.category}
                    </span>
                  </Slot>
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Confidence</dt>
                <dd className="mt-0.5">
                  <Slot w="w-20" shown={shown("category")}>
                    <ConfidenceBadge value={sample.confidence} />
                  </Slot>
                </dd>
              </div>
            </dl>

            <table className="mt-2 w-full table-fixed text-sm">
              <caption className="sr-only">Line items</caption>
              <thead>
                <tr className="text-xs text-muted-foreground">
                  <th className="py-1 pl-1 text-left font-normal" scope="col">
                    Item
                  </th>
                  <th className="w-10 py-1 text-center font-normal" scope="col">
                    Qty
                  </th>
                  <th className="w-20 py-1 text-right font-normal" scope="col">
                    Price
                  </th>
                  <th className="w-16 py-1 text-right font-normal" scope="col">
                    <span className="sr-only">Confidence</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {sample.items.map((item, i) => {
                  const on = shown(`item-${i}`);
                  const low = confidenceLevel(item.confidence) === "review";
                  return (
                    <tr
                      className={cn(
                        "border-t border-border",
                        on && low && "bg-warning/5 shadow-[inset_3px_0_0_var(--warning)]",
                      )}
                      key={item.name}
                    >
                      <td className="max-w-0 truncate py-1 pl-1">
                        <Slot w="w-32" shown={on}>
                          {low ? (
                            <TriangleAlert
                              aria-label="Low confidence"
                              className="mr-1.5 inline size-3.5 align-[-2px] text-warning"
                            />
                          ) : null}
                          {item.name}
                        </Slot>
                      </td>
                      <td className="py-1 text-center font-mono text-muted-foreground tabular-nums">
                        <Slot w="w-4" shown={on}>
                          {item.quantity}
                        </Slot>
                      </td>
                      <td className="py-1 text-right font-mono tabular-nums">
                        <Slot w="w-12" shown={on}>
                          {usd(item.totalPrice)}
                        </Slot>
                      </td>
                      <td
                        className={cn(
                          "py-1 pr-1 text-right font-mono text-xs tabular-nums",
                          low ? "font-medium text-warning" : "text-muted-foreground",
                        )}
                      >
                        <Slot w="w-8" shown={on}>
                          {formatConfidence(item.confidence)}
                        </Slot>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            <dl className="mt-1 grid gap-1 border-t border-border pt-2.5 text-sm">
              {(
                [
                  ["Subtotal", "subtotal", sample.subtotal],
                  ["Tax", "tax", sample.tax],
                  ...(sample.tip === null ? [] : ([["Tip", "tip", sample.tip]] as const)),
                ] as const
              ).map(([label, key, value]) => (
                <div className="flex justify-between text-muted-foreground" key={key}>
                  <dt>{label}</dt>
                  <dd className="font-mono tabular-nums">
                    <Slot w="w-14" shown={shown(key)}>
                      {usd(value)}
                    </Slot>
                  </dd>
                </div>
              ))}
              <div className="flex justify-between text-base font-semibold">
                <dt>Total</dt>
                <dd className="font-mono tabular-nums">
                  <Slot w="w-16" shown={shown("total")}>
                    {usd(sample.total)}
                  </Slot>
                </dd>
              </div>
            </dl>

            <p
              className={cn(
                "mt-2 flex min-h-5 items-center gap-1.5 text-xs",
                done && needsCheck.length ? "text-warning" : "text-muted-foreground",
              )}
            >
              {done && needsCheck.length ? (
                <>
                  <TriangleAlert aria-hidden="true" className="size-3.5 shrink-0" />
                  {needsCheck[0].name} was hard to read. Check it against the photo.
                </>
              ) : done ? (
                `Items${sample.tip === null ? " and tax add" : ", tax and tip add"} up to the total.`
              ) : null}
            </p>
          </div>
        </div>

        {/* The export */}
        <div className="border-t border-border bg-secondary/40">
          <div className="flex items-center justify-between gap-3 px-4 pt-2.5 pb-1.5">
            <p className="font-mono text-xs text-muted-foreground">
              <span className="font-medium text-foreground">export.csv</span> · {rows.length} rows
            </p>
            <Button onClick={download} size="sm" type="button" variant="ghost">
              <Download aria-hidden="true" />
              Download
            </Button>
          </div>
          <table className="w-full table-fixed font-mono text-xs tabular-nums">
            <caption className="sr-only">Rows in the sample export</caption>
            <thead>
              <tr className="text-muted-foreground">
                <th className="w-28 py-1.5 pl-4 text-left font-normal sm:w-32" scope="col">
                  receipt_date
                </th>
                <th className="py-1.5 pl-3 text-left font-normal" scope="col">
                  merchant
                </th>
                <th
                  className="hidden w-28 py-1.5 pl-3 text-left font-normal sm:table-cell"
                  scope="col"
                >
                  category
                </th>
                <th
                  className="hidden w-16 py-1.5 pl-3 text-right font-normal sm:table-cell"
                  scope="col"
                >
                  tax
                </th>
                <th className="w-20 py-1.5 pr-4 pl-3 text-right font-normal" scope="col">
                  total
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 3).map((r) => {
                const isLanded = "id" in r && r.id === landed;
                return (
                  <tr
                    className={cn("border-t border-border", isLanded && "e-land")}
                    key={r.merchant}
                  >
                    <td className="py-1.5 pl-4 whitespace-nowrap">{r.receiptDate}</td>
                    <td className="max-w-0 truncate py-1.5 pl-3 font-sans text-[13px]">
                      {r.merchant}
                    </td>
                    <td className="hidden py-1.5 pl-3 font-sans text-[13px] sm:table-cell">
                      {r.category}
                    </td>
                    <td className="hidden py-1.5 pl-3 text-right sm:table-cell">{plain(r.tax)}</td>
                    <td className="py-1.5 pr-4 pl-3 text-right font-medium">{plain(r.total)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {dragging ? (
          <div className="absolute inset-2 z-10 flex flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-primary bg-card/95 text-center">
            <Upload aria-hidden="true" className="size-5 text-primary" />
            <p className="text-sm font-medium">Drop to run the demo</p>
            <p className="max-w-64 text-xs text-muted-foreground">
              Your file isn&apos;t opened or uploaded. A sample receipt plays instead.
            </p>
          </div>
        ) : null}
      </div>

      <p aria-live="polite" className="mt-3 min-h-5 text-xs text-muted-foreground">
        {dropped ? (
          <>
            <span className="font-mono text-foreground">{dropped}</span> stayed on your device; that
            was a sample.{" "}
            <Link
              className="font-medium text-primary underline-offset-4 hover:underline"
              href="/sign-up"
            >
              Sign up to scan your own
            </Link>
            .
          </>
        ) : null}
        <span className="sr-only">{announce}</span>
      </p>
    </div>
  );
}
