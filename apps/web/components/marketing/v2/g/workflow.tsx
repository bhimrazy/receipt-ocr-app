import { cn } from "@receipt-ocr/ui/lib/utils";
import { RotateCw } from "lucide-react";
import { csvHeader, csvRows, history } from "./data";
import { Confidence, Fig, SectionHead, Status, container } from "./parts";

const steps = [
  {
    n: "01",
    title: "Upload",
    body: "Take a photo on your phone or drop in scans, up to 20 at a time.",
    spec: "PNG · JPG · HEIC",
  },
  {
    n: "02",
    title: "Scan",
    body: "Google's Gemini model scans the image and returns every field and line item.",
    spec: "Google Gemini",
  },
  {
    n: "03",
    title: "Check",
    body: "Each receipt and each line gets a confidence score. Low scores tell you where to look.",
    spec: "High ≥ 90% · Check ≥ 75%",
  },
  {
    n: "04",
    title: "Export",
    body: "Download the corrected records as CSV, one receipt or the whole workspace.",
    spec: "receipts.csv",
  },
];

export function HowItWorks() {
  return (
    <section
      aria-labelledby="g-how"
      className={cn(container, "scroll-mt-20 py-16 lg:py-24")}
      id="how"
    >
      <SectionHead
        id="g-how"
        index="01"
        label="How it works"
        lede="No templates to set up and no rules to write. The same four steps for a coffee or a quarter's worth of supplier invoices."
        title="Four steps from shoebox to spreadsheet."
      />
      <ol className="mt-14 grid border-t border-border sm:grid-cols-2 lg:ml-[calc((100%+24px)/4)] lg:grid-cols-4">
        {steps.map((step, i) => (
          <li
            className={cn(
              "flex flex-col border-b border-border py-6 sm:pr-6 lg:border-b-0 lg:py-2 lg:pt-6",
              i > 0 && "lg:border-l lg:pl-6",
              i % 2 === 1 && "sm:border-l sm:pl-6",
            )}
            key={step.n}
          >
            <p className="g-mono text-sm text-primary">{step.n}</p>
            <h3 className="mt-3 text-lg font-semibold tracking-[-0.01em]">{step.title}</h3>
            <p className="mt-2 text-[15px] leading-6 text-(--g-ink-2)">{step.body}</p>
            <p className="g-mono mt-5 text-xs text-muted-foreground lg:mt-auto lg:pt-6">
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
    <div className="overflow-hidden rounded-xl border border-(--g-rule-strong) bg-card shadow-(--g-shadow)">
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <p className="text-sm font-semibold">History</p>
        <p className="text-xs text-muted-foreground">6 receipts · Oct 2026</p>
      </div>

      {/* Desktop: the table, columns as in components/history-table.tsx. */}
      <table className="hidden w-full text-sm sm:table">
        <caption className="sr-only">Example receipt history</caption>
        <thead className="border-b border-border bg-muted/60">
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
                <td className="g-num whitespace-nowrap px-4 py-3 text-(--g-ink-2)">{row.date}</td>
                <td className="hidden px-4 py-3 text-(--g-ink-2) md:table-cell">{row.category}</td>
                <td className="px-4 py-3">
                  <Status status="done" />
                </td>
                <td className="px-4 py-3">
                  <Confidence score={row.confidence} />
                </td>
                <td className="g-mono px-4 py-3 text-right">{row.total}</td>
              </tr>
            ) : (
              <tr className="border-b border-border last:border-0" key={row.file}>
                <td className="g-mono px-4 py-3 text-[13px] text-(--g-ink-2)">{row.file}</td>
                <td className="g-num whitespace-nowrap px-4 py-3 text-(--g-ink-2)">
                  {row.uploaded}
                </td>
                <td className="hidden md:table-cell" />
                <td className="px-4 py-3">
                  <Status status={row.status} />
                </td>
                <td className="px-4 py-3 text-xs text-muted-foreground" colSpan={2}>
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
                <p className="g-num mt-0.5 text-xs text-muted-foreground">
                  {row.date} · {row.category}
                </p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                <span className="g-mono text-sm">{row.total}</span>
                <Confidence score={row.confidence} />
              </div>
            </li>
          ) : (
            <li className="flex items-start justify-between gap-4 px-4 py-3" key={row.file}>
              <div className="min-w-0">
                <p className="g-mono truncate text-[13px] text-(--g-ink-2)">{row.file}</p>
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

function CsvPreview() {
  return (
    <div className="overflow-hidden rounded-xl border border-(--g-rule-strong) bg-card">
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <p className="g-mono text-[13px]">receipts.csv</p>
        <p className="text-xs text-muted-foreground">4 rows · 6 of 14 columns</p>
      </div>
      <div
        aria-label="CSV preview, scrolls sideways"
        className="overflow-x-auto outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        role="region"
        tabIndex={0}
      >
        <table className="g-mono w-full min-w-[520px] text-[12px]">
          <caption className="sr-only">CSV export preview</caption>
          <thead>
            <tr className="border-b border-border text-muted-foreground">
              {csvHeader.map((col, i) => (
                <th
                  className={cn("px-4 py-2 font-normal", i >= 4 ? "text-right" : "text-left")}
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
              <tr className="border-b border-border last:border-0" key={row[0] + row[1]}>
                {row.map((cell, i) => (
                  <td
                    className={cn(
                      "whitespace-nowrap px-4 py-2",
                      i >= 4 ? "text-right" : "text-left",
                      i === 0 && "max-w-[12rem] truncate",
                    )}
                    key={i}
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function Workspace() {
  return (
    <section aria-labelledby="g-workspace" className="border-y border-border bg-card">
      <div className={cn(container, "py-16 lg:py-24")}>
        <SectionHead
          id="g-workspace"
          index="02"
          label="The record"
          lede="Every receipt lands in one history with its status in plain words. Nothing reads “$0.00” while it's still processing, and a receipt that can't be scanned says so and offers a retry."
          title="A history you can hand to your accountant."
        />
        <div className="mt-14 grid gap-x-6 gap-y-10 lg:grid-cols-12">
          <div className="min-w-0 lg:col-span-12">
            <HistoryTable />
            <div className="mt-3">
              <Fig n="2">Workspace history. Amounts right-aligned, statuses in words.</Fig>
            </div>
          </div>
          <div className="min-w-0 lg:col-span-7">
            <CsvPreview />
            <div className="mt-3">
              <Fig n="3">The same records as CSV, ready for a spreadsheet or your books.</Fig>
            </div>
          </div>
          <div className="min-w-0 lg:col-span-5">
            <dl className="divide-y divide-border border-y border-border text-sm">
              {[
                ["Edit before export", "Merchant, date, category, currency and amounts"],
                ["Export scope", "One receipt, or everything in the workspace"],
                ["Per receipt", "Copy the full record as JSON"],
              ].map(([k, v]) => (
                <div className="grid grid-cols-[minmax(0,10rem)_1fr] gap-4 py-3" key={k}>
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
