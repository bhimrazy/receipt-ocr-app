import { demoExport } from "@/components/marketing/content";
import { SectionHead, Tick } from "./primitives";

const short = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });

const sum = demoExport.reduce((total, row) => total + Number(row.total), 0).toFixed(2);

const points = [
  "Opens in Excel, Google Sheets or Numbers.",
  "One receipt, or everything in your workspace.",
  "Totals stay numbers, so your spreadsheet can add them up.",
  "Prefer code? Copy any receipt as JSON.",
];

export function LedgerD() {
  return (
    <section aria-labelledby="output" className="scroll-mt-20 border-t border-border">
      <div className="mx-auto grid max-w-6xl gap-x-14 gap-y-12 px-4 py-20 sm:px-6 lg:grid-cols-[0.8fr_1.2fr] lg:items-center lg:py-28">
        <div>
          <SectionHead
            eyebrow="What you get"
            id="output"
            lead="One row per receipt: date, merchant, category, tax, total and the rest. The kind of file an accountant is happy to receive."
            title="A spreadsheet, not a shoebox."
          />
          <ul className="mt-8 space-y-3">
            {points.map((point) => (
              <li className="flex gap-3 text-[0.95rem] leading-6" key={point}>
                <Tick className="mt-1 text-[var(--d-accent)]" />
                {point}
              </li>
            ))}
          </ul>
        </div>

        <figure className="min-w-0">
          <div className="d-sheet relative grid grid-cols-[1.25rem_1fr_1.25rem] rounded-sm sm:grid-cols-[1.75rem_1fr_1.75rem]">
            <div aria-hidden className="d-sprockets border-r border-dashed border-border" />
            <table className="d-greenbar w-full text-sm">
              <caption className="sr-only">Sample CSV export, five receipts from October</caption>
              <thead>
                <tr className="d-mono border-b border-[var(--input)] text-[0.68rem] tracking-[0.12em] text-muted-foreground uppercase">
                  <th className="px-2 py-3 text-left font-medium sm:px-3" scope="col">
                    Date
                  </th>
                  <th className="px-2 py-3 text-left font-medium sm:px-3" scope="col">
                    Merchant
                  </th>
                  <th className="hidden px-3 py-3 text-left font-medium sm:table-cell" scope="col">
                    Category
                  </th>
                  <th className="hidden px-3 py-3 text-right font-medium sm:table-cell" scope="col">
                    Tax
                  </th>
                  <th className="px-2 py-3 text-right font-medium sm:px-3" scope="col">
                    Total
                  </th>
                </tr>
              </thead>
              <tbody>
                {demoExport.map((row) => (
                  <tr key={row.date + row.merchant}>
                    <td className="d-mono px-2 py-3 whitespace-nowrap text-muted-foreground sm:px-3">
                      <time dateTime={row.date}>{short(row.date)}</time>
                    </td>
                    <td className="px-2 py-3 font-medium sm:px-3">{row.merchant}</td>
                    <td className="hidden px-3 py-3 text-muted-foreground sm:table-cell">
                      {row.category}
                    </td>
                    <td className="d-mono hidden px-3 py-3 text-right sm:table-cell">${row.tax}</td>
                    <td className="d-mono px-2 py-3 text-right font-medium sm:px-3">
                      ${row.total}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div aria-hidden className="d-sprockets border-l border-dashed border-border" />
          </div>
          <figcaption className="mt-5 flex flex-col gap-2 sm:flex-row sm:items-baseline sm:justify-between">
            <span className="d-display d-wonk text-lg text-[var(--d-accent)]">
              October, sorted: ${sum} across five receipts.
            </span>
            <span className="d-mono text-xs text-muted-foreground">receipts.csv · sample data</span>
          </figcaption>
        </figure>
      </div>
    </section>
  );
}
