import { cn } from "@receipt-ocr/ui/lib/utils";
import { RotateCw } from "lucide-react";
import { csvHeader, csvRows, history } from "./data";
import { Confidence, Fig, SectionHead, Status, container } from "./parts";

const steps = [
  {
    n: "01",
    who: "You",
    title: "Drop them in",
    body: "Photos from your phone or scans from the office, up to 20 per upload. Each one is read for the merchant, date, every line, tax and total.",
    spec: "PNG · JPG · HEIC",
  },
  {
    n: "02",
    who: "You, briefly",
    title: "Check what we flag",
    body: "Every line gets a confidence score. The shaky ones say “Check this line”, so you check the photo where it matters. Fix the merchant, date, category or amounts if anything's off.",
    spec: "Edit before export",
  },
  {
    n: "03",
    who: "Done",
    title: "Export the rows",
    body: "One CSV for a receipt or the whole workspace. It opens in Excel or Google Sheets, and imports into QuickBooks or Xero.",
    spec: "receipts.csv",
  },
];

export function HowItWorks() {
  return (
    <section
      aria-labelledby="fl-how"
      className={cn(container, "scroll-mt-20 py-16 lg:py-24")}
      id="how"
    >
      <SectionHead
        id="fl-how"
        index="01"
        label="How it works"
        lede="No templates to set up and no rules to write. The same three steps for one coffee or a quarter's worth of supplier receipts."
        title="Three steps. The middle one is you."
      />
      <ol className="mt-12 grid border-t border-border lg:ml-[calc((100%+24px)/4)] lg:grid-cols-3">
        {steps.map((step, i) => (
          <li
            className={cn(
              "flex flex-col border-b border-border py-6 lg:border-b-0 lg:pt-6 lg:pr-6",
              i > 0 && "lg:border-l lg:pl-6",
              i === 1 && "bg-(--fl-primary-tint)/60 max-lg:-mx-4 max-lg:px-4",
            )}
            key={step.n}
          >
            <p className="flex items-baseline justify-between gap-3">
              <span className="fl-mono text-sm text-primary">{step.n}</span>
              <span className="text-xs font-medium text-muted-foreground">{step.who}</span>
            </p>
            <h3 className="mt-3 text-xl font-semibold tracking-[-0.015em]">{step.title}</h3>
            <p className="mt-2 text-[15px] leading-6 text-(--fl-ink-2)">{step.body}</p>
            <p className="fl-mono mt-5 text-xs text-muted-foreground lg:mt-auto lg:pt-6">
              {step.spec}
            </p>
          </li>
        ))}
      </ol>
    </section>
  );
}

const th = "px-4 py-2.5 text-left text-xs font-medium text-muted-foreground";

function HistoryTable() {
  return (
    <div className="overflow-hidden rounded-xl border border-(--fl-rule-strong) bg-card shadow-(--fl-shadow)">
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <p className="text-sm font-semibold">History</p>
        <p className="text-xs text-muted-foreground">6 receipts · Oct 2026</p>
      </div>

      {/* Desktop: the table, columns as in components/history-table.tsx. */}
      <table className="hidden w-full text-sm sm:table">
        <caption className="sr-only">Example receipt history</caption>
        <thead className="border-b border-border bg-background">
          <tr>
            <th className={th} scope="col">
              Merchant
            </th>
            <th className={th} scope="col">
              Date
            </th>
            <th className={cn(th, "hidden md:table-cell")} scope="col">
              Category
            </th>
            <th className={th} scope="col">
              Status
            </th>
            <th className={th} scope="col">
              Confidence
            </th>
            <th className={cn(th, "text-right")} scope="col">
              Total
            </th>
          </tr>
        </thead>
        <tbody>
          {history.map((row) =>
            row.status === "done" ? (
              <tr className="border-b border-border last:border-0" key={row.merchant}>
                <td className="max-w-[16rem] truncate px-4 py-3 font-medium">{row.merchant}</td>
                <td className="px-4 py-3 whitespace-nowrap text-(--fl-ink-2)">{row.date}</td>
                <td className="hidden px-4 py-3 text-(--fl-ink-2) md:table-cell">{row.category}</td>
                <td className="px-4 py-3">
                  <Status status="done" />
                </td>
                <td className="px-4 py-3">
                  <Confidence score={row.confidence} />
                </td>
                <td className="fl-mono px-4 py-3 text-right">{row.total}</td>
              </tr>
            ) : (
              <tr className="border-b border-border last:border-0" key={row.file}>
                <td className="fl-mono px-4 py-3 text-[13px] text-(--fl-ink-2)">{row.file}</td>
                <td className="px-4 py-3 whitespace-nowrap text-(--fl-ink-2)">{row.uploaded}</td>
                <td className="hidden md:table-cell" />
                <td className="px-4 py-3">
                  <Status status={row.status} />
                </td>
                <td className="px-4 py-3 text-xs text-(--fl-ink-2)" colSpan={2}>
                  {row.status === "reading" ? (
                    "Updates on its own when it's done."
                  ) : (
                    <span className="flex items-center justify-between gap-3">
                      Retry, or upload a clearer photo.
                      <span className="inline-flex items-center gap-1 font-medium text-primary">
                        <RotateCw aria-hidden="true" className="size-3" />
                        Retry
                      </span>
                    </span>
                  )}
                </td>
              </tr>
            ),
          )}
        </tbody>
      </table>

      {/* Mobile: one row per receipt, total on the right, like the app's list view. */}
      <ul className="divide-y divide-border sm:hidden">
        {history.map((row) =>
          row.status === "done" ? (
            <li className="flex items-start justify-between gap-4 px-4 py-3" key={row.merchant}>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{row.merchant}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {row.date} · {row.category}
                </p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                <span className="fl-mono text-sm">{row.total}</span>
                <Confidence score={row.confidence} />
              </div>
            </li>
          ) : (
            <li className="flex items-start justify-between gap-4 px-4 py-3" key={row.file}>
              <div className="min-w-0">
                <p className="fl-mono truncate text-[13px] text-(--fl-ink-2)">{row.file}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {row.status === "reading"
                    ? "Updates on its own when it's done."
                    : "Retry, or upload a clearer photo."}
                </p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                <Status status={row.status} />
                {row.status === "failed" ? (
                  <span className="inline-flex items-center gap-1 text-xs font-medium text-primary">
                    <RotateCw aria-hidden="true" className="size-3" />
                    Retry
                  </span>
                ) : null}
              </div>
            </li>
          ),
        )}
      </ul>
    </div>
  );
}

/** Columns kept below sm, so the figure fits a phone without sideways scrolling. */
const MOBILE_COLS = new Set(["merchant", "receipt_date", "total"]);

function CsvPreview() {
  return (
    <div className="overflow-hidden rounded-xl border border-(--fl-rule-strong) bg-card">
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <p className="fl-mono text-[13px]">receipts.csv</p>
        <p className="text-xs text-muted-foreground">
          4 rows · <span className="sm:hidden">3</span>
          <span className="hidden sm:inline">6</span> of 14 columns
        </p>
      </div>
      <table className="fl-mono w-full table-fixed text-xs">
        <caption className="sr-only">CSV export preview</caption>
        <thead>
          <tr className="border-b border-border text-muted-foreground">
            {csvHeader.map((col, i) => (
              <th
                className={cn(
                  "px-3 py-2 font-normal first:pl-4 last:pr-4",
                  i >= 4 ? "text-right" : "text-left",
                  !MOBILE_COLS.has(col) && "hidden sm:table-cell",
                  col === "merchant" && "w-[42%] sm:w-auto",
                  col === "receipt_date" && "w-[7.5rem]",
                  col === "currency" && "w-[4.5rem]",
                  col === "tax" && "w-14",
                  col === "total" && "w-[4.5rem]",
                )}
                key={col}
                scope="col"
              >
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {csvRows.map((row) => (
            <tr className="border-b border-border last:border-0" key={row[0]}>
              {row.map((cell, i) => (
                <td
                  className={cn(
                    "truncate px-3 py-2 first:pl-4 last:pr-4",
                    i >= 4 ? "text-right" : "text-left",
                    !MOBILE_COLS.has(csvHeader[i]) && "hidden sm:table-cell",
                  )}
                  key={csvHeader[i]}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Workspace() {
  return (
    <section aria-labelledby="fl-workspace" className="border-y border-border bg-card">
      <div className={cn(container, "py-16 lg:py-24")}>
        <SectionHead
          id="fl-workspace"
          index="02"
          label="The record"
          lede="Every receipt lands in one history and says what it's doing in plain words. If one can't be read, it tells you and offers a retry, instead of pretending it cost $0.00."
          title="One place for every receipt. Your bookkeeper can open it too."
        />
        <div className="mt-12 grid gap-x-6 gap-y-10 lg:grid-cols-12">
          <div className="min-w-0 lg:col-span-12">
            <HistoryTable />
            <div className="mt-3">
              <Fig n="2">Workspace history. Amounts right-aligned, statuses in words.</Fig>
            </div>
          </div>
          <div className="min-w-0 lg:col-span-7">
            <CsvPreview />
            <div className="mt-3">
              <Fig n="3">
                The same records as CSV. Open it in Excel or Google Sheets, or import it into
                QuickBooks or Xero.
              </Fig>
            </div>
          </div>
          <div className="min-w-0 lg:col-span-5">
            <dl className="divide-y divide-border border-y border-border text-sm">
              {[
                ["You can fix", "Merchant, date, category, currency and amounts"],
                ["Line items", "Read and scored; not editable yet"],
                ["Export", "One receipt, or everything in the workspace"],
                ["Per receipt", "Copy the full record as JSON"],
              ].map(([k, v]) => (
                <div className="grid grid-cols-[minmax(0,8.5rem)_1fr] gap-4 py-3" key={k}>
                  <dt className="text-muted-foreground">{k}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      </div>
    </section>
  );
}
