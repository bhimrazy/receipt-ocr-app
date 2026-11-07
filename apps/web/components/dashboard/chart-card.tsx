import { Card } from "@receipt-ocr/ui/components/card";
import { cn } from "@receipt-ocr/ui/lib/utils";
import Link from "next/link";
import type { ReactNode } from "react";

/**
 * A dashboard card: title, a one-line text summary of what the chart shows
 * (read first by screen readers, useful to everyone), the chart, and an
 * optional table of the same numbers.
 */
export function ChartCard({
  title,
  description,
  summary,
  table,
  className,
  children,
}: {
  title: string;
  description?: ReactNode;
  summary?: ReactNode;
  table?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Card className={cn("flex min-w-0 flex-col gap-4 p-4 md:p-5", className)}>
      <div>
        <h3 className="text-sm font-medium">{title}</h3>
        {description ? <p className="mt-0.5 text-xs text-muted-foreground">{description}</p> : null}
      </div>
      {summary ? <p className="text-sm text-muted-foreground">{summary}</p> : null}
      {children}
      {table}
    </Card>
  );
}

export type TableColumn<Row> = {
  header: string;
  cell: (row: Row) => ReactNode;
  numeric?: boolean;
};

/** The chart's numbers as a table, behind a native disclosure. */
export function DataTable<Row>({
  caption,
  columns,
  rows,
}: {
  caption: string;
  columns: TableColumn<Row>[];
  rows: Row[];
}) {
  return (
    <details className="group text-sm">
      <summary className="inline-flex min-h-9 cursor-pointer items-center rounded-md text-xs font-medium text-primary outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring max-md:min-h-11">
        <span className="group-open:hidden">Show as table</span>
        <span className="hidden group-open:inline">Hide table</span>
      </summary>
      <div className="mt-2 max-h-80 overflow-auto rounded-md border border-border">
        <table className="w-full text-xs">
          <caption className="sr-only">{caption}</caption>
          <thead className="sticky top-0 bg-card">
            <tr className="border-b border-border">
              {columns.map((c) => (
                <th
                  className={cn(
                    "px-3 py-2 font-medium text-muted-foreground",
                    c.numeric ? "text-right" : "text-left",
                  )}
                  key={c.header}
                  scope="col"
                >
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((row, i) => (
              <tr key={i}>
                {columns.map((c) => (
                  <td
                    className={cn(
                      "px-3 py-1.5",
                      c.numeric ? "text-right font-mono tabular-nums" : "text-left",
                    )}
                    key={c.header}
                  >
                    {c.cell(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

export type BarRow = {
  key: string;
  label: string;
  amount: string;
  value: number;
  detail: string;
  href?: string;
};

/**
 * Ranked horizontal bars, labelled directly: name and amount on one line,
 * the bar under it. One colour; length carries the value.
 */
export function BarList({ rows, label }: { rows: BarRow[]; label: string }) {
  const max = Math.max(...rows.map((r) => r.value), 0);
  return (
    <ul aria-label={label} className="flex flex-col gap-1">
      {rows.map((row) => {
        const body = (
          <>
            <span className="flex items-baseline justify-between gap-3 text-sm">
              <span className="min-w-0 truncate">{row.label}</span>
              <span className="shrink-0 font-mono tabular-nums">{row.amount}</span>
            </span>
            <span className="mt-1 flex items-center gap-2">
              <span className="h-1.5 flex-1 rounded-full bg-wash">
                <span
                  className="block h-full rounded-full bg-primary"
                  style={{ width: `${max > 0 ? Math.max(2, (row.value / max) * 100) : 0}%` }}
                />
              </span>
              <span className="w-20 shrink-0 text-right text-2xs text-muted-foreground">
                {row.detail}
              </span>
            </span>
          </>
        );
        return (
          <li key={row.key}>
            {row.href ? (
              <Link
                className="block rounded-md px-2 py-1.5 outline-none hover:bg-wash-subtle focus-visible:ring-2 focus-visible:ring-ring max-md:py-2.5"
                href={row.href}
              >
                {body}
              </Link>
            ) : (
              <div className="px-2 py-1.5 max-md:py-2.5">{body}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
