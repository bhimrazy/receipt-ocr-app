import { cn } from "@receipt-ocr/ui/lib/utils";
import { formatTime } from "@/lib/format";

export type Usage = { used: number; limit: number; resetsAt: Date };

/** Receipts used today against the plan limit. Turns amber at 80%. */
export function UsageMeter({
  usage,
  planLabel,
  className,
}: {
  usage: Usage;
  planLabel: string;
  className?: string;
}) {
  const { used, limit, resetsAt } = usage;
  const ratio = limit > 0 ? Math.min(1, used / limit) : 0;
  const nearLimit = ratio >= 0.8;
  return (
    <div className={cn("rounded-lg border border-border bg-card p-4", className)}>
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-xs text-muted-foreground">{planLabel}</p>
        <p className="font-mono text-xs tabular-nums text-muted-foreground">
          <span className="text-base font-semibold text-foreground">{used}</span> of {limit} today
        </p>
      </div>
      <div
        aria-label="Receipts used today"
        aria-valuemax={limit}
        aria-valuemin={0}
        aria-valuenow={used}
        aria-valuetext={`${used} of ${limit} receipts used today`}
        className="mt-3 h-1.5 overflow-hidden rounded-full bg-input/60"
        role="meter"
      >
        <div
          className={cn("h-full rounded-full", nearLimit ? "bg-warning" : "bg-primary")}
          style={{ width: `${ratio * 100}%` }}
        />
      </div>
      {nearLimit ? (
        <p className="mt-2 text-xs text-warning">
          {used >= limit ? "Limit reached." : `${limit - used} left.`} Resets at{" "}
          {formatTime(resetsAt)}.
        </p>
      ) : null}
    </div>
  );
}
