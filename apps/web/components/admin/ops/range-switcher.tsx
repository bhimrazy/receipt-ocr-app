import { OPS_RANGES, type OpsRange } from "@receipt-ocr/core";
import { cn } from "@receipt-ocr/ui/lib/utils";
import Link from "next/link";

const LABELS: Record<OpsRange, string> = { "24h": "24 hours", "7d": "7 days", "30d": "30 days" };

const href = (range: OpsRange, compare: boolean) => {
  const params = new URLSearchParams();
  if (range !== "24h") params.set("range", range);
  if (compare) params.set("compare", "1");
  const search = params.toString();
  return search ? `/admin/operations?${search}` : "/admin/operations";
};

const item =
  "inline-flex min-h-11 items-center rounded-md px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring md:min-h-8";

/** Range and comparison live in the URL, so a link to an incident view shows the same thing. */
export function RangeSwitcher({ range, compare }: { range: OpsRange; compare: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <nav
        aria-label="Time range"
        className="inline-flex rounded-lg border border-border bg-card p-0.5"
      >
        {OPS_RANGES.map((r) => (
          <Link
            aria-current={r === range ? "page" : undefined}
            className={cn(
              item,
              r === range
                ? "bg-accent text-accent-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
            href={href(r, compare)}
            key={r}
            scroll={false}
          >
            {LABELS[r]}
          </Link>
        ))}
      </nav>
      <Link
        className={cn(
          item,
          "border border-border",
          compare
            ? "bg-accent text-accent-foreground"
            : "text-muted-foreground hover:text-foreground",
        )}
        href={href(range, !compare)}
        scroll={false}
      >
        {compare ? "Stop comparing" : "Compare with previous period"}
      </Link>
    </div>
  );
}
