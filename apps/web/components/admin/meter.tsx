import { cn } from "@receipt-ocr/ui/lib/utils";

/**
 * Used against a limit, e.g. receipts today. Amber from 80%, red at the
 * limit, and the numbers are always printed so colour is never the only cue.
 */
export function Meter({
  used,
  limit,
  label,
  className,
  showNumbers = true,
}: {
  used: number;
  limit: number;
  /** Accessible name, e.g. "Receipts used today". */
  label: string;
  className?: string;
  showNumbers?: boolean;
}) {
  const ratio = limit > 0 ? Math.min(1, used / limit) : 0;
  const tone = ratio >= 1 ? "bg-destructive" : ratio >= 0.8 ? "bg-warning" : "bg-primary";
  return (
    <div className={cn("flex min-w-0 items-center gap-2.5", className)}>
      <div
        aria-label={label}
        aria-valuemax={limit}
        aria-valuemin={0}
        aria-valuenow={Math.min(used, limit)}
        aria-valuetext={`${used} of ${limit}`}
        className="h-1.5 min-w-12 flex-1 overflow-hidden rounded-full bg-foreground/15"
        role="meter"
      >
        <div className={cn("h-full rounded-full", tone)} style={{ width: `${ratio * 100}%` }} />
      </div>
      {showNumbers ? (
        <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
          <span className="text-foreground">{used}</span> / {limit}
        </span>
      ) : null}
    </div>
  );
}
