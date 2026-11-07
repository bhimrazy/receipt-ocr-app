import { cn } from "@receipt-ocr/ui/lib/utils";
import { Check, FileImage, LoaderCircle } from "lucide-react";
import { demoExport, demoReceipt as r } from "./content";
import "./marketing.css";

/*
 * Static fragments of the real product UI, filled with one consistent demo receipt. They are
 * illustrations: each exposes a single text alternative and hides its inner text from screen
 * readers, so the page outline stays clean.
 */

export function ReceiptSlip({
  className,
  scanning = false,
}: {
  className?: string;
  scanning?: boolean;
}) {
  return (
    <div
      role="img"
      aria-label={`Photo of a receipt from ${r.merchant}, ${r.date}, total ${r.total}`}
      className={cn(
        "receipt-edge relative overflow-hidden bg-[var(--paper)] px-5 pb-8 pt-6 font-mono text-[11px] leading-5 text-[var(--paper-ink)] shadow-2xl shadow-black/60",
        className,
      )}
    >
      {scanning && (
        <div
          aria-hidden
          className="scan-line pointer-events-none absolute inset-x-0 top-0 [--primary:#059669]"
        />
      )}
      <div aria-hidden>
        <p className="text-center text-xs font-bold tracking-[0.2em]">{r.shortMerchant}</p>
        <p className="text-center text-[var(--paper-muted)]">Office Supply · Store 0412</p>
        <p className="mt-1 text-center text-[var(--paper-muted)]">
          {r.date} {r.time}
        </p>
        <div className="my-3 border-t border-dashed border-[var(--paper-muted)]/60" />
        <ul className="flex flex-col gap-0.5">
          {r.items.map((item) => (
            <li className="flex justify-between gap-3" key={item.name}>
              <span className="truncate">
                {item.qty} {item.name}
              </span>
              <span className="tabular-nums">{item.price.slice(1)}</span>
            </li>
          ))}
        </ul>
        <div className="my-3 border-t border-dashed border-[var(--paper-muted)]/60" />
        <p className="flex justify-between">
          <span>SUBTOTAL</span>
          <span className="tabular-nums">{r.subtotal.slice(1)}</span>
        </p>
        <p className="flex justify-between">
          <span>TAX 8.875%</span>
          <span className="tabular-nums">{r.tax.slice(1)}</span>
        </p>
        <p className="mt-1 flex justify-between text-xs font-bold">
          <span>TOTAL</span>
          <span className="tabular-nums">{r.total}</span>
        </p>
        <p className="mt-3 text-center text-[var(--paper-muted)]">VISA •••• 4417 · THANK YOU</p>
      </div>
    </div>
  );
}

function ConfidencePill({ value }: { value: number }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-primary/12 px-2 py-0.5 font-mono text-[11px] tabular-nums text-primary">
      <Check className="size-3" aria-hidden />
      {value}% confidence
    </span>
  );
}

export function ExtractedPanel({
  className,
  compact = false,
}: {
  className?: string;
  compact?: boolean;
}) {
  return (
    <div
      role="img"
      aria-label={`Extracted data: ${r.merchant}, ${r.date}, category ${r.category}, ${r.items.length} line items, tax ${r.tax}, total ${r.total}, ${r.confidence}% confidence.`}
      className={cn(
        "card-sheen overflow-hidden rounded-2xl bg-card text-sm shadow-2xl shadow-black/50 ring-1 ring-white/10",
        className,
      )}
    >
      <div aria-hidden>
        <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-3.5">
          <p className="font-medium">Extracted data</p>
          <ConfidencePill value={r.confidence} />
        </div>
        {!compact && (
          <dl className="grid grid-cols-3 gap-3 border-b border-border px-5 py-4 text-xs">
            {[
              ["Merchant", "Paper & Co."],
              ["Date", r.isoDate],
              ["Category", r.category],
            ].map(([k, v]) => (
              <div className="min-w-0" key={k}>
                <dt className="text-muted-foreground">{k}</dt>
                <dd className="mt-1 truncate font-mono text-foreground">{v}</dd>
              </div>
            ))}
          </dl>
        )}
        <div className="px-5 py-4">
          <div className="grid grid-cols-[minmax(0,1fr)_2.5rem_4.5rem] items-center gap-x-3 gap-y-2.5">
            <span className="text-xs text-muted-foreground">Item</span>
            <span className="text-right text-xs text-muted-foreground">Qty</span>
            <span className="text-right text-xs text-muted-foreground">Price</span>
            {r.items.map((item) => (
              <div className="contents" key={item.name}>
                <span className="truncate">{item.name}</span>
                <span className="text-right font-mono text-xs tabular-nums text-muted-foreground">
                  {item.qty}
                </span>
                <span className="text-right font-mono tabular-nums">{item.price}</span>
              </div>
            ))}
          </div>
          <div className="mt-4 grid grid-cols-[1fr_auto] gap-y-1.5 border-t border-border pt-4">
            <span className="text-muted-foreground">Subtotal</span>
            <span className="text-right font-mono tabular-nums text-muted-foreground">
              {r.subtotal}
            </span>
            <span className="text-muted-foreground">Tax</span>
            <span className="text-right font-mono tabular-nums text-muted-foreground">{r.tax}</span>
            <span className="font-semibold">Total</span>
            <span className="text-right font-mono font-semibold tabular-nums text-primary">
              {r.total}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

export function CsvSheet({ className }: { className?: string }) {
  return (
    <div
      role="img"
      aria-label={`Example preview of a CSV export with ${demoExport.length} receipts: date, merchant, category, tax and total columns`}
      className={cn("overflow-hidden rounded-xl bg-card ring-1 ring-white/10", className)}
    >
      <div aria-hidden>
        <div className="flex items-center justify-between border-b border-border bg-secondary/60 px-4 py-2.5 font-mono text-xs text-muted-foreground">
          <span className="truncate">Preview · receipts.csv</span>
          <span className="shrink-0">{demoExport.length} rows</span>
        </div>
        <div className="grid grid-cols-[7.25rem_minmax(0,1fr)_4.5rem] font-mono text-xs tabular-nums sm:grid-cols-[7.25rem_minmax(0,1fr)_6rem_4rem_4.5rem]">
          {["receipt_date", "merchant", "category", "tax", "total"].map((h) => (
            <span
              className={cn(
                "truncate border-b border-border px-3 py-2 text-primary",
                (h === "category" || h === "tax") && "hidden sm:block",
                (h === "tax" || h === "total") && "text-right",
              )}
              key={h}
            >
              {h}
            </span>
          ))}
          {demoExport.map((row) => (
            <div className="contents" key={row.date + row.merchant}>
              <span className="border-b border-border/60 px-3 py-2 text-muted-foreground">
                {row.date}
              </span>
              <span className="truncate border-b border-border/60 px-3 py-2">{row.merchant}</span>
              <span className="hidden truncate border-b border-border/60 px-3 py-2 text-muted-foreground sm:block">
                {row.category}
              </span>
              <span className="hidden border-b border-border/60 px-3 py-2 text-right text-muted-foreground sm:block">
                {row.tax}
              </span>
              <span className="border-b border-border/60 px-3 py-2 text-right">{row.total}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function JsonBlock({ className }: { className?: string }) {
  const json = {
    merchant: r.merchant,
    receipt_date: r.isoDate,
    category: r.category,
    currency: r.currency,
    subtotal: 79.77,
    tax: 7.08,
    total: 86.85,
    confidence: r.confidence / 100,
    items: r.items.slice(0, 2).map((i) => ({
      name: i.name,
      quantity: Number(i.qty),
      total_price: Number(i.price.slice(1)),
      confidence: i.confidence / 100,
    })),
  };
  return (
    <pre
      aria-label="Example of a receipt's data as JSON"
      className={cn(
        "overflow-x-auto rounded-xl bg-card p-5 font-mono text-xs leading-6 text-muted-foreground ring-1 ring-white/10",
        className,
      )}
    >
      <code>{JSON.stringify(json, null, 2)}</code>
    </pre>
  );
}

const queue = [
  { name: "IMG_4021.HEIC", state: "Done", icon: Check },
  { name: "IMG_4022.HEIC", state: "Scanning…", icon: LoaderCircle },
  { name: "scan-taxi.jpg", state: "Queued", icon: FileImage },
];

export function UploadQueue({ className }: { className?: string }) {
  return (
    <div
      role="img"
      aria-label="Upload queue: three photos, one done, one being scanned, one queued"
      className={cn("rounded-xl bg-card p-4 ring-1 ring-white/10", className)}
    >
      <div aria-hidden>
        <div className="rounded-lg border border-dashed border-border px-4 py-5 text-center">
          <p className="text-sm font-medium">Drop receipts or take a photo</p>
          <p className="mt-1 font-mono text-[11px] text-muted-foreground">
            PNG, JPG, HEIC · up to 10 MB · 20 at a time
          </p>
        </div>
        <ul className="mt-3 flex flex-col gap-2">
          {queue.map(({ name, state, icon: Icon }) => (
            <li
              className="flex items-center justify-between gap-3 rounded-lg bg-secondary/60 px-3 py-2 font-mono text-xs"
              key={name}
            >
              <span className="truncate">{name}</span>
              <span
                className={cn(
                  "inline-flex shrink-0 items-center gap-1.5",
                  state === "Done" ? "text-primary" : "text-muted-foreground",
                )}
              >
                <Icon
                  className={cn("size-3.5", state === "Scanning…" && "motion-safe:animate-spin")}
                />
                {state}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
