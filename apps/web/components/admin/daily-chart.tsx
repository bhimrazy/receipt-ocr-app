import { formatDate } from "@/lib/format";

type Day = { day: string; completed: number; failed: number };

const short = (day: string) =>
  new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(
    new Date(`${day}T00:00:00Z`),
  );

/**
 * Receipts per UTC day, read and failed stacked. The bars are decoration for
 * sighted users (values show on hover); the table under them carries the data
 * for screen readers.
 */
export function DailyChart({ days }: { days: Day[] }) {
  const max = Math.max(1, ...days.map((d) => d.completed + d.failed));
  return (
    <figure className="rounded-lg border border-border bg-card p-4">
      <figcaption className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-medium">Receipts per day, last 14 days</span>
        <span className="flex items-center gap-4 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span aria-hidden="true" className="size-2.5 rounded-sm bg-primary" />
            Read
          </span>
          <span className="flex items-center gap-1.5">
            <span aria-hidden="true" className="size-2.5 rounded-sm bg-destructive" />
            Failed
          </span>
        </span>
      </figcaption>
      <div
        aria-hidden="true"
        className="flex h-36 items-end gap-1 border-b border-border sm:gap-1.5"
      >
        {days.map((d) => {
          const total = d.completed + d.failed;
          return (
            <div
              className="group relative flex h-full min-w-0 flex-1 flex-col justify-end"
              key={d.day}
            >
              <div
                className="flex flex-col justify-end gap-0.5"
                style={{ height: `${(total / max) * 100}%` }}
              >
                {d.failed > 0 ? (
                  <div
                    className="min-h-0.5 rounded-t-[3px] bg-destructive"
                    style={{ flexGrow: d.failed }}
                  />
                ) : null}
                {d.completed > 0 ? (
                  <div
                    className={
                      d.failed > 0
                        ? "min-h-0.5 bg-primary group-hover:bg-primary/80"
                        : "min-h-0.5 rounded-t-[3px] bg-primary group-hover:bg-primary/80"
                    }
                    style={{ flexGrow: d.completed }}
                  />
                ) : null}
              </div>
              <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 hidden -translate-x-1/2 rounded-md border border-border bg-popover px-2 py-1 text-xs whitespace-nowrap text-popover-foreground shadow-md group-hover:block">
                <span className="font-medium">{short(d.day)}</span>
                <span className="ml-2 font-mono tabular-nums">
                  {d.completed} read · {d.failed} failed
                </span>
              </div>
            </div>
          );
        })}
      </div>
      <div
        aria-hidden="true"
        className="mt-1.5 flex justify-between font-mono text-2xs text-muted-foreground"
      >
        <span>{short(days[0]!.day)}</span>
        <span>Today</span>
      </div>
      <table className="sr-only">
        <caption>Receipts per day, last 14 days</caption>
        <thead>
          <tr>
            <th scope="col">Day</th>
            <th scope="col">Read</th>
            <th scope="col">Failed</th>
          </tr>
        </thead>
        <tbody>
          {days.map((d) => (
            <tr key={d.day}>
              <th scope="row">{formatDate(d.day)}</th>
              <td>{d.completed}</td>
              <td>{d.failed}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
