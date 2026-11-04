import { cn } from "@receipt-ocr/ui/lib/utils";
import { ChevronDown, Copy, Download, Search, TriangleAlert } from "lucide-react";
import { ConfidenceBadge } from "@/components/receipt-status";
import { formatDate, formatMoney } from "@/lib/format";
import { samples } from "./fixtures";

/*
 * Static slices of the app, drawn to match apps/web/components (editor, history, export).
 * They are pictures, not controls: the wrapper hides them from assistive tech and the
 * figure caption describes them.
 */

const hardware = samples[1];
const usd = (value: number) => formatMoney(value, "USD");

function Frame({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "e-window pointer-events-none overflow-hidden rounded-2xl border border-border bg-card select-none",
        className,
      )}
      inert
    >
      {children}
    </div>
  );
}

function FakeField({
  label,
  value,
  mono,
  select,
  className,
}: {
  label: string;
  value: string;
  mono?: boolean;
  select?: boolean;
  className?: string;
}) {
  return (
    <div className={className}>
      <p className="mb-1 text-xs font-medium text-muted-foreground">{label}</p>
      <p
        className={cn(
          "flex h-9 items-center justify-between rounded-lg border border-input/60 bg-card px-3 text-sm",
          mono && "font-mono tabular-nums",
        )}
      >
        <span className="truncate">{value}</span>
        {select ? <ChevronDown className="size-4 text-muted-foreground" /> : null}
      </p>
    </div>
  );
}

export function ReviewFragment() {
  return (
    <Frame>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-5 py-3.5">
        <p className="font-semibold">{hardware.merchant}</p>
        <ConfidenceBadge value={hardware.confidence} />
      </div>
      <div className="grid gap-5 p-5 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="grid grid-cols-2 gap-3">
          <FakeField className="col-span-2" label="Merchant" value={hardware.merchant} />
          <FakeField label="Date" mono value={hardware.receiptDate} />
          <FakeField label="Category" select value={hardware.category} />
          <FakeField label="Tax" mono value={hardware.tax.toFixed(2)} />
          <FakeField label="Total" mono value={hardware.total.toFixed(2)} />
        </div>
        <div className="min-w-0">
          <p className="mb-1 text-xs font-medium text-muted-foreground">Line items</p>
          <ul className="text-sm">
            {hardware.items.map((item) => {
              const low = item.confidence < 0.75;
              return (
                <li
                  className={cn(
                    "flex items-center justify-between gap-3 border-t border-border px-2 py-2 first:border-t-0",
                    low && "bg-warning/5 shadow-[inset_3px_0_0_var(--warning)]",
                  )}
                  key={item.name}
                >
                  <span className="flex min-w-0 items-center gap-1.5">
                    {low ? <TriangleAlert className="size-3.5 shrink-0 text-warning" /> : null}
                    <span className="truncate">{item.name}</span>
                  </span>
                  <span className="font-mono tabular-nums">{usd(item.totalPrice)}</span>
                </li>
              );
            })}
          </ul>
          <p className="mt-2 flex items-start gap-1.5 text-xs text-warning">
            <TriangleAlert className="mt-px size-3.5 shrink-0" />
            Highlighted items were hard to read. Check them against the photo.
          </p>
        </div>
      </div>
    </Frame>
  );
}

const historyRows = [
  {
    merchant: "Hartley Hardware",
    file: "scan-0193.png",
    date: "2026-10-24",
    category: "Equipment",
    total: 133.12,
    confidence: 0.84,
  },
  {
    merchant: "Hartley Hardware",
    file: "IMG_1988.jpg",
    date: "2026-10-03",
    category: "Equipment",
    total: 46.5,
    confidence: 0.95,
  },
  {
    merchant: "Hart & Field Florist",
    file: "IMG_1902.jpg",
    date: "2026-09-19",
    category: "Supplies",
    total: 32,
    confidence: 0.93,
  },
];

export function HistoryFragment() {
  return (
    <Frame>
      <div className="flex flex-col gap-2 border-b border-border p-4 sm:flex-row sm:items-center">
        <p className="flex h-9 flex-1 items-center gap-2 rounded-lg border border-input/60 px-3 text-sm">
          <Search className="size-4 text-muted-foreground" />
          hart
          <span className="e-caret" />
        </p>
        <p className="flex h-9 items-center justify-between gap-1.5 rounded-lg border border-border px-3 text-sm">
          All categories <ChevronDown className="size-4 text-muted-foreground" />
        </p>
      </div>
      <ul>
        {historyRows.map((row) => (
          <li
            className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 border-t border-border px-4 py-3 first:border-t-0 sm:grid-cols-[minmax(0,1fr)_6rem_auto_5.5rem]"
            key={row.file}
          >
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium">{row.merchant}</span>
              <span className="block truncate font-mono text-xs text-muted-foreground">
                {row.file} · {formatDate(row.date)}
              </span>
            </span>
            <span className="hidden text-sm text-muted-foreground sm:block">{row.category}</span>
            <span className="hidden sm:block">
              <ConfidenceBadge showScore={false} value={row.confidence} />
            </span>
            <span className="text-right font-mono text-sm tabular-nums">{usd(row.total)}</span>
          </li>
        ))}
      </ul>
      <p className="border-t border-border px-4 py-2.5 font-mono text-xs text-muted-foreground">
        3 results for “hart”
      </p>
    </Frame>
  );
}

const csvLines = [
  "merchant,receipt_date,category,currency,tax,tip,total",
  "Bluebird Café,2026-10-26,Meals,USD,1.29,2.00,17.79",
  "Hartley Hardware,2026-10-24,Equipment,USD,10.15,,133.12",
  "Osteria Lume,2026-10-22,Meals,USD,9.50,21.40,137.90",
  "Metro Transit,2026-10-20,Travel,USD,0.00,,45.00",
];

export function ExportFragment() {
  return (
    <Frame>
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <p className="font-mono text-xs">
          receipts-2026-10.csv <span className="text-muted-foreground">· 4 rows</span>
        </p>
        <p className="flex h-8 items-center gap-1.5 rounded-full bg-primary px-3 text-xs font-medium text-primary-foreground">
          <Download className="size-3.5" /> Export CSV
        </p>
      </div>
      <pre className="overflow-hidden p-4 font-mono text-[11.5px] leading-6 text-muted-foreground">
        {csvLines.map((line, i) => (
          <span
            className={cn("block truncate", i === 0 ? "text-foreground" : undefined)}
            key={line}
          >
            {line}
          </span>
        ))}
      </pre>
      <div className="border-t border-border bg-secondary/50 px-4 py-3">
        <p className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
          <span>Copy one receipt as JSON</span>
          <Copy className="size-3.5" />
        </p>
        <pre className="overflow-hidden font-mono text-[11.5px] leading-5">
          <span className="block truncate">
            {"{ "}
            <span className="text-primary">&quot;merchant&quot;</span>: &quot;Osteria Lume&quot;,{" "}
            <span className="text-primary">&quot;total&quot;</span>: 137.9,{" "}
            <span className="text-primary">&quot;tip&quot;</span>: 21.4, …{" }"}
          </span>
        </pre>
      </div>
    </Frame>
  );
}
