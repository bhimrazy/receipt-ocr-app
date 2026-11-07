import { cn } from "@receipt-ocr/ui/lib/utils";
import { exportRows } from "./ledger";
import { SectionHead } from "./primitives";

/** A slice of history with the app's real status words (components/receipt-status.tsx). */
function Files() {
  const files = [
    { name: "scan-0193.png", status: "Scanned", tone: "text-foreground" },
    { name: "IMG_2041.jpg", status: "Scanning…", tone: "text-muted-foreground" },
    { name: "lunch.jpg", status: "Couldn't scan · Retry", tone: "text-[var(--pp-accent)]" },
  ];
  return (
    <ul
      aria-label="Example uploads and their status"
      className="pp-sheet divide-y divide-border rounded-md"
    >
      {files.map((file) => (
        <li
          className="pp-mono flex items-center justify-between gap-3 px-3.5 py-2.5 text-xs"
          key={file.name}
        >
          <span className="truncate font-medium">{file.name}</span>
          <span className={cn("shrink-0", file.tone)}>{file.status}</span>
        </li>
      ))}
    </ul>
  );
}

function Fix() {
  const field = "mt-1 rounded-md border border-[var(--input)] bg-background/60 px-3 py-2 text-sm";
  return (
    <div
      aria-label="Correcting the merchant and category of a receipt"
      className="pp-sheet rounded-lg p-4"
      role="img"
    >
      <p className="text-xs text-muted-foreground">Merchant</p>
      <p className={field}>
        Hartley Hardware
        <span className="ml-px inline-block h-4 w-px translate-y-0.5 bg-foreground" />
      </p>
      <div className="mt-3 flex items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">Category</p>
          <p className={cn(field, "flex items-center gap-6")}>
            Equipment
            <svg aria-hidden className="size-3" fill="none" viewBox="0 0 12 12">
              <path
                d="m3 4.5 3 3 3-3"
                stroke="currentColor"
                strokeLinecap="round"
                strokeWidth="1.5"
              />
            </svg>
          </p>
        </div>
        <span className="pp-stamp pp-mono -rotate-3 rounded-sm px-2 py-1 text-[0.75rem] font-medium tracking-[0.14em] uppercase">
          Checked
        </span>
      </div>
    </div>
  );
}

function Export() {
  const rows = exportRows.slice(0, 3);
  return (
    <figure className="pp-sheet rounded-md p-3.5">
      <figcaption className="pp-mono flex justify-between text-xs text-muted-foreground">
        <span className="font-medium text-foreground">receipts.csv</span>
        <span>3 of {exportRows.length} rows</span>
      </figcaption>
      <table className="pp-mono mt-2 w-full text-xs">
        <caption className="sr-only">Three rows of a sample CSV export</caption>
        <thead>
          <tr className="border-b border-[var(--input)] text-muted-foreground">
            <th className="py-1 text-left font-normal" scope="col">
              merchant
            </th>
            <th className="py-1 pl-2 text-left font-normal" scope="col">
              receipt_date
            </th>
            <th className="py-1 text-right font-normal" scope="col">
              total
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr className="border-b border-border/70 last:border-0" key={row.merchant}>
              <td className="max-w-0 truncate py-1.5 sm:max-w-none">{row.merchant}</td>
              <td className="py-1.5 pl-2 whitespace-nowrap">{row.receipt_date}</td>
              <td className="py-1.5 text-right">{row.total}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

const steps = [
  {
    title: "Drop them in.",
    body: "Phone photos or scans: PNG, JPG or HEIC, up to 10 MB each and 20 at a time. They're scanned one after another, and anything that can't be scanned says so, with a retry.",
    visual: <Files />,
  },
  {
    title: "Check the bits it flags.",
    body: 'Every receipt, and every line on it, gets a confidence score. Low ones say "check this line", so you know what to compare with the photo. Fix the merchant, date, category, currency or totals right there. Line items are read and scored, but not editable yet.',
    visual: <Fix />,
  },
  {
    title: "Export, and get on with your day.",
    body: "Download a CSV for one receipt or the whole workspace, or copy a receipt as JSON. No export fees, no lock-in.",
    visual: <Export />,
  },
];

export function HowPaper() {
  return (
    <section aria-labelledby="how" className="scroll-mt-20 bg-secondary/60">
      <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 lg:py-28">
        <SectionHead
          eyebrow="How it works"
          id="how"
          lead="ReceiptOCR does the scanning. You decide what goes in your books."
          title={
            <>
              Three steps. The middle one is <span className="pp-wonk">you.</span>
            </>
          }
        />
        <ol className="mt-14 border-b border-[var(--input)]/50">
          {steps.map((step, index) => (
            <li
              className={cn(
                "grid grid-cols-[2.75rem_1fr] gap-x-4 gap-y-6 border-t border-[var(--input)]/50 py-10 md:grid-cols-[6rem_1fr_17rem] md:gap-10 lg:grid-cols-[8rem_1fr_19rem]",
              )}
              key={step.title}
            >
              <span
                aria-hidden
                className="pp-display pp-wonk text-5xl leading-none text-[var(--pp-accent)] md:text-7xl"
              >
                {index + 1}
              </span>
              <div className="max-w-md">
                <h3 className="pp-display text-2xl sm:text-[1.75rem]">
                  <span className="sr-only">Step {index + 1}: </span>
                  {step.title}
                </h3>
                <p className="mt-3 leading-relaxed text-muted-foreground">{step.body}</p>
              </div>
              <div className="col-start-2 max-w-xs md:col-start-auto md:max-w-none">
                {step.visual}
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
