import { cn } from "@receipt-ocr/ui/lib/utils";
import { FileImage, TriangleAlert } from "lucide-react";
import { ConfidenceBadge } from "@/components/receipt-status";
import { confidenceLevel, formatConfidence, formatDate, formatMoney } from "@/lib/format";
import { DemoPlayer, type DemoSample } from "./demo-player";
import { earlierRows, type Sample, samples, stepsFor } from "./fixtures";

/*
 * Server-rendered markup for each sample, always in its finished state. DemoPlayer only sets
 * data-state on the wrapper; classic.css turns that into the scan and the staggered fill, with
 * each field's delay taken from its --i (its position in stepsFor).
 */

const usd = (value: number) => formatMoney(value, "USD");
const isLow = (confidence: number) => confidenceLevel(confidence) === "review";

type Step = (key: string) => React.CSSProperties;

function stepper(sample: Sample): { step: Step; count: number } {
  const steps = stepsFor(sample);
  return {
    count: steps.length,
    step: (key) => ({ "--i": steps.indexOf(key) }) as React.CSSProperties,
  };
}

/**
 * A value with a placeholder pill over it. The value always holds its place in the layout (it is
 * only made transparent while unread), so filling it in shifts nothing.
 */
function Field({
  style,
  className,
  children,
}: {
  style: React.CSSProperties;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span className={cn("fc-field relative inline-block max-w-full", className)} style={style}>
      <span className="fc-v">{children}</span>
      <span aria-hidden className="fc-slot" />
    </span>
  );
}

/** Shows only while the demo is in the given state. */
function When({
  state,
  children,
}: {
  state: "scanning" | "filling" | "done";
  children: React.ReactNode;
}) {
  return <span className={`fc-when-${state}`}>{children}</span>;
}

/** The receipt photo, drawn in HTML. */
function Paper({ sample, step }: { sample: Sample; step: Step }) {
  const [y, m, d] = sample.receiptDate.split("-");
  const line = "fc-line flex justify-between gap-3 rounded-[2px]";
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
        className="fc-paper relative overflow-hidden rounded-t-md border-x border-t border-white/10 px-4 pt-4 font-mono text-[0.6875rem] leading-[1.7] text-foreground/85 uppercase"
      >
        <div className="fc-scan" />
        <p
          className={cn(
            line,
            "justify-center text-[0.8rem] font-semibold tracking-wide text-foreground",
          )}
          style={step("merchant")}
        >
          {sample.merchant}
        </p>
        <p className="text-center text-muted-foreground max-sm:hidden">{sample.address}</p>
        <p className={cn(line, "mt-2")} style={step("date")}>
          <span>
            {m}/{d}/{y}
          </span>
          <span>{sample.time}</span>
        </p>
        <div className="fc-dashed my-2" />
        {sample.items.map((item, i) => (
          <p
            className={cn(line, isLow(item.confidence) && "fc-smudged fc-flag")}
            key={item.name}
            style={step(`item-${i}`)}
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
          <p className={line} style={step("subtotal")}>
            <span>Subtotal</span>
            <span className="fc-num">{sample.subtotal.toFixed(2)}</span>
          </p>
          <p className={line} style={step("tax")}>
            <span>Tax</span>
            <span className="fc-num">{sample.tax.toFixed(2)}</span>
          </p>
          {sample.tip !== null && (
            <p className={line} style={step("tip")}>
              <span>Tip</span>
              <span className="fc-num">{sample.tip.toFixed(2)}</span>
            </p>
          )}
          <p
            className={cn(line, "mt-1 text-[0.8rem] font-semibold text-foreground")}
            style={step("total")}
          >
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
function CsvStrip({ sample, count }: { sample: Sample; count: number }) {
  const earlier = earlierRows[0];
  // The row lands after the last field.
  const last = { "--i": count } as React.CSSProperties;
  return (
    <div className="border-t border-border bg-background/50">
      <p className="flex items-baseline justify-between gap-3 px-4 pt-3 font-mono text-xs text-muted-foreground sm:px-5">
        <span className="text-foreground">receipts.csv</span>
        <span>
          <When state="scanning">Waiting for the scan</When>
          <When state="filling">Waiting for the scan</When>
          <When state="done">1 row added</When>
        </span>
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
          <tr className="fc-land border-t border-border">
            <td className={cn(csvCell, "text-foreground")}>
              <Field className="block truncate" style={last}>
                {sample.merchant}
              </Field>
            </td>
            <td className={csvCell}>
              <Field style={last}>{sample.receiptDate}</Field>
            </td>
            <td className={cn(csvCell, "hidden sm:table-cell")}>
              <Field style={last}>{sample.category}</Field>
            </td>
            <td className={cn(csvCell, "fc-num text-right text-foreground")}>
              <Field style={last}>{sample.total.toFixed(2)}</Field>
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

/** Everything below the sample picker, for one sample. */
function Panel({ sample }: { sample: Sample }) {
  const { step, count } = stepper(sample);
  const hasLow = sample.items.some((item) => isLow(item.confidence));
  const totals = [
    ["Subtotal", "subtotal", sample.subtotal],
    ["Tax", "tax", sample.tax],
    ["Tip", "tip", sample.tip],
  ] as const;

  return (
    <>
      <div className="grid sm:grid-cols-[14rem_minmax(0,1fr)]">
        {/* The photo */}
        <div className="flex flex-col items-center gap-3 border-b border-border bg-background/40 px-5 pt-5 pb-4 max-sm:px-10 sm:border-r sm:border-b-0">
          <Paper sample={sample} step={step} />
          <span className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1 font-mono text-[0.6875rem] text-muted-foreground">
            <FileImage aria-hidden className="size-3 shrink-0" />
            <span className="truncate">{sample.fileName}</span>
          </span>
        </div>

        {/* What was read */}
        <div className="min-w-0 p-4 sm:p-5">
          <div className="flex min-h-6 items-center justify-between gap-3">
            <p className="text-sm font-medium">Extracted data</p>
            <span className="font-mono text-xs text-muted-foreground">
              <When state="scanning">Scanning the photo…</When>
              <When state="filling">Filling in the fields…</When>
              <When state="done">
                <ConfidenceBadge value={sample.confidence} />
              </When>
            </span>
          </div>

          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 border-y border-border py-3 text-sm">
            <div className="col-span-2">
              <dt className="text-xs text-muted-foreground">Merchant</dt>
              <dd className="mt-0.5 text-base font-semibold">
                <Field style={step("merchant")}>{sample.merchant}</Field>
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Date</dt>
              <dd className="mt-0.5 font-mono">
                <Field style={step("date")}>{formatDate(sample.receiptDate)}</Field>
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Category</dt>
              <dd className="mt-0.5">
                <Field style={step("category")}>
                  <span className="inline-flex rounded-full border border-border bg-secondary px-2 py-0.5 text-xs font-medium">
                    {sample.category}
                  </span>
                </Field>
              </dd>
            </div>
          </dl>

          <table className="mt-2 w-full table-fixed text-sm">
            <caption className="sr-only">Line items, with how sure the scan is for each</caption>
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
                const low = isLow(item.confidence);
                const at = step(`item-${i}`);
                return (
                  <tr className="border-t border-border/70 align-top" key={item.name}>
                    <td className="py-1.5 pr-2">
                      <Field className="block truncate" style={at}>
                        {item.name}
                      </Field>
                      {low && (
                        <span className="fc-hard mt-0.5 flex items-center gap-1 text-xs font-medium text-warning">
                          <TriangleAlert aria-hidden className="size-3" />
                          Hard to read
                        </span>
                      )}
                    </td>
                    <td className="fc-num py-1.5 text-right font-mono text-muted-foreground">
                      <Field style={at}>{item.quantity}</Field>
                    </td>
                    <td className="fc-num py-1.5 text-right font-mono">
                      <Field style={at}>{usd(item.totalPrice)}</Field>
                    </td>
                    <td
                      className={cn(
                        "fc-num py-1.5 text-right font-mono text-xs leading-5",
                        low ? "font-semibold text-warning" : "text-muted-foreground",
                      )}
                    >
                      <Field style={at}>
                        {formatConfidence(item.confidence)}
                        {low && <span className="sr-only"> (low confidence, hard to read)</span>}
                      </Field>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {hasLow && (
            <p className="mt-1.5 text-xs leading-5 text-muted-foreground">
              Highlighted items were hard to read. Check them against the photo.
            </p>
          )}

          <dl className="mt-2 grid gap-1 border-t border-border pt-2.5 text-sm">
            {totals.map(([label, key, value]) => (
              <div className="flex justify-between text-muted-foreground" key={key}>
                <dt>{label}</dt>
                <dd className={cn(value !== null && "fc-num font-mono")}>
                  {/* A blank field stays blank: no tip on the paper means none is guessed. */}
                  <Field style={step(value === null ? "tax" : key)}>
                    {value === null ? "Not on receipt" : usd(value)}
                  </Field>
                </dd>
              </div>
            ))}
            <div className="mt-0.5 flex justify-between font-semibold">
              <dt>Total</dt>
              <dd className="fc-num font-mono text-primary">
                <Field style={step("total")}>{usd(sample.total)}</Field>
              </dd>
            </div>
          </dl>
        </div>
      </div>

      <CsvStrip count={count} sample={sample} />
    </>
  );
}

function announcement(sample: Sample) {
  const low = sample.items.filter((item) => isLow(item.confidence));
  return `Scanned ${sample.merchant}: total ${usd(sample.total)}, category ${sample.category}.${
    low.length ? ` Hard to read: ${low.map((item) => item.name).join(", ")}.` : ""
  }`;
}

export function HeroDemo() {
  const meta: DemoSample[] = samples.map((sample) => ({
    id: sample.id,
    label: sample.label,
    slug: sample.slug,
    steps: stepsFor(sample).length,
    announcement: announcement(sample),
  }));
  const panels = Object.fromEntries(samples.map((s) => [s.id, <Panel key={s.id} sample={s} />]));

  return (
    <div className="relative isolate">
      <div aria-hidden className="fc-glow absolute -inset-x-16 -inset-y-10 -z-10" />
      <DemoPlayer panels={panels} samples={meta} />
    </div>
  );
}
