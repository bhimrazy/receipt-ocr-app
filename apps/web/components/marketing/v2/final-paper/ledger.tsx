import { cn } from "@receipt-ocr/ui/lib/utils";
import { earlierRows, samples } from "./fixtures";
import { SectionHead, Tick } from "./primitives";

/** Sample rows in the export's own shape: lib/csv.ts column names, plain numbers. */
export const exportRows = [...samples, ...earlierRows]
  .map((r) => ({
    merchant: r.merchant,
    receipt_date: r.receiptDate,
    category: r.category,
    currency: "USD",
    tax: r.tax.toFixed(2),
    total: r.total.toFixed(2),
  }))
  .sort((a, b) => b.receipt_date.localeCompare(a.receipt_date));

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
  "CSV opens in Excel and Google Sheets, and imports into QuickBooks or Xero.",
  "Export one receipt, or everything in your workspace.",
  "Amounts stay plain numbers, so a spreadsheet can add them up.",
  "Prefer code? Copy any receipt as JSON.",
];

export function LedgerPaper() {
  return (
    <section aria-labelledby="output" className="scroll-mt-20 border-t border-border">
      <div className="mx-auto grid max-w-6xl gap-x-14 gap-y-12 px-4 py-20 sm:px-6 lg:grid-cols-[0.75fr_1.25fr] lg:items-center lg:py-28">
        <div>
          <SectionHead
            eyebrow="What you get"
            id="output"
            lead="One row per receipt, with the date, merchant, category, tax and total already filled in."
            title="A spreadsheet, not a shoebox."
          />
          <ul className="mt-8 space-y-3">
            {points.map((point) => (
              <li className="flex gap-3 text-[0.95rem] leading-6" key={point}>
                <Tick className="mt-1 text-[var(--pp-accent)]" />
                {point}
              </li>
            ))}
          </ul>
        </div>

        <figure className="min-w-0">
          <div className="pp-sheet relative grid grid-cols-[1.25rem_minmax(0,1fr)_1.25rem] rounded-sm sm:grid-cols-[1.75rem_minmax(0,1fr)_1.75rem]">
            <div aria-hidden className="pp-sprockets border-r border-dashed border-border" />
            <table className="pp-greenbar w-full text-sm">
              <caption className="sr-only">Preview of the CSV export, five sample receipts</caption>
              <thead>
                <tr className="pp-mono border-b border-[var(--input)] text-[0.75rem] text-muted-foreground">
                  {columns.map((c) => (
                    <th
                      className={cn(
                        "px-2 py-3 font-medium sm:px-3",
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
                  <tr key={row.receipt_date + row.merchant}>
                    {columns.map((c) => (
                      <td
                        className={cn(
                          "px-2 py-3 sm:px-3",
                          c.key === "merchant" ? "font-medium" : "pp-mono whitespace-nowrap",
                          c.num ? "text-right" : "text-left",
                          c.key === "total" && "font-medium",
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
            </table>
            <div aria-hidden className="pp-sprockets border-l border-dashed border-border" />
          </div>
          <figcaption className="mt-5 flex flex-col gap-2 sm:flex-row sm:items-baseline sm:justify-between">
            <span className="pp-display pp-wonk text-lg text-[var(--pp-accent)]">
              October, sorted: ${sum} across five receipts.
            </span>
            <span className="pp-mono text-xs text-muted-foreground">
              Preview · sample data, some columns hidden
            </span>
          </figcaption>
        </figure>
      </div>
    </section>
  );
}
