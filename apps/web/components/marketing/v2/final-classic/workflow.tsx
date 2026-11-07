import { cn } from "@receipt-ocr/ui/lib/utils";
import { Check, CircleAlert, CircleCheck, Download, Loader2, RotateCcw } from "lucide-react";
import { Section, SectionHead, focusRing } from "./primitives";
import { sampleExportRows } from "./sample-export";

/** Sample rows in the export's own shape: lib/csv.ts column names, plain numbers. */
const exportRows = sampleExportRows.map((r) => ({
  id: r.id,
  merchant: r.merchant,
  receipt_date: r.receiptDate,
  category: r.category,
  currency: r.currency,
  tax: r.tax,
  total: r.total,
}));

const sum = exportRows.reduce((total, row) => total + Number(row.total), 0).toFixed(2);

// Column order follows lib/csv.ts; the rest of its columns are left out of the preview.
const columns: Array<{ key: keyof (typeof exportRows)[number]; num?: boolean; wide?: boolean }> = [
  { key: "merchant" },
  { key: "receipt_date" },
  { key: "category", wide: true },
  { key: "currency", wide: true },
  { key: "tax", num: true, wide: true },
  { key: "total", num: true },
];

const points = [
  "Export one receipt, or everything in your workspace.",
  "Amounts are plain numbers, so a spreadsheet can add them up.",
  "Need it in code? Copy any receipt as JSON.",
];

export function Output() {
  return (
    <Section id="output">
      <div className="grid gap-x-14 gap-y-12 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:items-center">
        <div>
          <SectionHead
            id="output"
            label="Export"
            lead="Merchant, date, category, currency, tax and total, with amounts as plain numbers. Opens in Excel, Google Sheets and Numbers."
            title="One row per receipt"
          />
          <ul className="mt-8 space-y-3">
            {points.map((point) => (
              <li className="flex gap-3 text-[0.95rem] leading-6" key={point}>
                <Check aria-hidden className="mt-1 size-4 shrink-0 text-primary" />
                {point}
              </li>
            ))}
          </ul>
        </div>

        <figure className="min-w-0">
          <div className="card-sheen overflow-hidden rounded-xl border border-border bg-card">
            <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3 sm:px-5">
              <span className="font-mono text-xs text-foreground">receipts.csv</span>
              <span className="font-mono text-xs text-muted-foreground">
                {exportRows.length} rows
              </span>
            </div>
            <table className="w-full text-sm">
              <caption className="sr-only">Preview of the CSV export, five sample receipts</caption>
              <thead>
                <tr className="border-b border-border font-mono text-xs text-muted-foreground">
                  {columns.map((c) => (
                    <th
                      className={cn(
                        "px-2 py-2.5 font-normal first:pl-4 last:pr-4 sm:px-3 sm:first:pl-5 sm:last:pr-5",
                        c.num ? "text-right" : "text-left",
                        c.wide && "hidden md:table-cell",
                      )}
                      key={c.key}
                      scope="col"
                    >
                      {c.key}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {exportRows.map((row) => (
                  <tr
                    className="border-b border-border/60 last:border-0 hover:bg-foreground/[0.02]"
                    key={row.id}
                  >
                    {columns.map((c) => (
                      <td
                        className={cn(
                          "px-2 py-3 first:pl-4 last:pr-4 sm:px-3 sm:first:pl-5 sm:last:pr-5",
                          c.key === "merchant"
                            ? "font-medium"
                            : "fc-num font-mono text-[0.8125rem] whitespace-nowrap text-muted-foreground",
                          c.num ? "text-right" : "text-left",
                          c.key === "total" && "text-foreground",
                          c.wide && "hidden md:table-cell",
                        )}
                        key={c.key}
                      >
                        {row[c.key]}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-border bg-secondary/50">
                  <th
                    className="py-3 pl-4 text-left text-xs font-normal text-muted-foreground sm:pl-5"
                    colSpan={2}
                    scope="row"
                  >
                    Sum of totals
                  </th>
                  <td className="hidden md:table-cell" colSpan={3} />
                  <td className="fc-num py-3 pr-4 text-right font-mono text-[0.8125rem] font-semibold text-primary sm:pr-5">
                    {sum}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
          <figcaption className="mt-3 font-mono text-xs text-muted-foreground">
            Sample data. The real file also has subtotal, tip, confidence, item count and more.{" "}
            <a
              className={cn(
                "rounded-sm text-foreground underline decoration-input underline-offset-4 hover:decoration-primary",
                focusRing,
              )}
              download
              href="/sample-receipts.csv"
            >
              Download sample CSV
            </a>
          </figcaption>
        </figure>
      </div>
    </Section>
  );
}

/** A slice of history with the app's real status words (components/receipt-status.tsx). */
function Uploads() {
  const files = [
    { name: "scan-0193.png", status: "Done", icon: CircleCheck, tone: "text-primary" },
    { name: "IMG_2041.jpg", status: "Scanning…", icon: Loader2, tone: "text-muted-foreground" },
    { name: "lunch.jpg", status: "Couldn't scan", icon: CircleAlert, tone: "text-destructive" },
  ];
  return (
    <ul aria-label="Example uploads and their status" className="divide-y divide-border">
      {files.map((file) => {
        const Icon = file.icon;
        return (
          <li className="flex items-center justify-between gap-3 py-2.5 text-xs" key={file.name}>
            <span className="truncate font-mono">{file.name}</span>
            <span className={cn("flex shrink-0 items-center gap-1.5 font-medium", file.tone)}>
              <Icon aria-hidden className="size-3.5" />
              {file.status}
              {file.status === "Couldn't scan" && (
                <span className="ml-1 inline-flex items-center gap-1 text-foreground">
                  <RotateCcw aria-hidden className="size-3" />
                  Retry
                </span>
              )}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function Correct() {
  const field =
    "mt-1 flex items-center justify-between rounded-md border border-input bg-background/60 px-3 py-2 text-sm";
  return (
    <div aria-label="Correcting the merchant and category of a receipt" role="img">
      <p className="text-xs text-muted-foreground">Merchant</p>
      <p className={cn(field, "border-primary ring-2 ring-ring/30")}>
        <span>
          Hartley Hardware
          <span className="ml-px inline-block h-4 w-px translate-y-0.5 bg-foreground" />
        </span>
      </p>
      <p className="mt-3 text-xs text-muted-foreground">Category</p>
      <p className={field}>
        Equipment
        <svg aria-hidden className="size-3 text-muted-foreground" fill="none" viewBox="0 0 12 12">
          <path d="m3 4.5 3 3 3-3" stroke="currentColor" strokeLinecap="round" strokeWidth="1.5" />
        </svg>
      </p>
    </div>
  );
}

function Export() {
  return (
    <div className="space-y-2.5">
      <p className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
        <span>All receipts</span>
        <span className="fc-num font-mono">{exportRows.length} rows</span>
      </p>
      <span className="flex h-10 items-center justify-center gap-2 rounded-full bg-primary text-sm font-medium text-primary-foreground">
        <Download aria-hidden className="size-4" />
        Download CSV
      </span>
      <span className="flex h-10 items-center justify-center rounded-full border border-border text-sm font-medium">
        Copy as JSON
      </span>
    </div>
  );
}

const steps = [
  {
    title: "Upload",
    body: "Phone photos or scans: PNG, JPG or HEIC, up to 10 MB each and 20 at a time. They are scanned one after another. If one can't be scanned, it says so and you can retry.",
    visual: <Uploads />,
  },
  {
    title: "Check",
    body: "Each receipt, and each line on it, gets a confidence score. Low scores tell you which line to compare with the photo. Fix the merchant, date, category, currency or totals. Line items are read and scored, but you can't edit them yet.",
    visual: <Correct />,
  },
  {
    title: "Export",
    body: "Download a CSV for one receipt or the whole workspace, or copy a receipt as JSON. There are no export fees.",
    visual: <Export />,
  },
];

export function How() {
  return (
    <Section className="bg-secondary/25" id="how">
      <SectionHead
        id="how"
        label="How it works"
        lead="ReceiptOCR scans each receipt. You check the result and decide what goes into your records."
        title="Upload, check, export"
      />
      <ol className="mt-14 grid gap-5 md:grid-cols-3">
        {steps.map((step, index) => (
          <li
            className="flex flex-col rounded-xl border border-border bg-card p-5 sm:p-6"
            key={step.title}
          >
            <span
              aria-hidden
              className="flex size-9 items-center justify-center rounded-lg border border-primary/25 bg-primary/10 font-mono text-sm font-semibold text-primary"
            >
              {String(index + 1).padStart(2, "0")}
            </span>
            <h3 className="mt-4 text-lg font-semibold">
              <span className="sr-only">Step {index + 1}: </span>
              {step.title}
            </h3>
            <p className="mt-2 text-[0.95rem] leading-relaxed text-muted-foreground">{step.body}</p>
            <div className="mt-auto pt-6">
              <div className="rounded-lg border border-border bg-background/60 p-4">
                {step.visual}
              </div>
            </div>
          </li>
        ))}
      </ol>
    </Section>
  );
}
