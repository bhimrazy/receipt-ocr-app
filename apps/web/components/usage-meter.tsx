import { cn } from "@receipt-ocr/ui/lib/utils";
import { CircleAlert } from "lucide-react";
import { formatTime } from "@/lib/format";

export type Usage = {
  used: number;
  limit: number;
  resetsAt: Date;
  blocked: "day" | "global" | null;
};

/** The one line that says how much room is left today, shared by the meter and the upload panel. */
export function usageNote({ used, limit, resetsAt, blocked }: Usage): string {
  const reset = formatTime(resetsAt);
  if (blocked === "global") return `Scanning is paused for everyone until ${reset}.`;
  const left = Math.max(0, limit - used);
  if (blocked === "day" || left === 0) return `Daily limit reached. Resets at ${reset}.`;
  return `${left} left today. Resets at ${reset}.`;
}

/** Receipts used today against the plan limit. Amber from 80%, with words, not colour alone. */
export function UsageMeter({
  usage,
  planLabel,
  className,
}: {
  usage: Usage;
  planLabel: string;
  className?: string;
}) {
  const { used, limit, blocked } = usage;
  const ratio = limit > 0 ? Math.min(1, used / limit) : 0;
  const warn = blocked !== null || ratio >= 0.8;

  return (
    <div className={cn("rounded-lg border border-border bg-card p-3.5", className)}>
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-xs text-muted-foreground">{planLabel}</p>
        <p className="font-mono text-xs text-muted-foreground tabular-nums">
          <span className="text-sm font-semibold text-foreground">{used}</span> / {limit} today
        </p>
      </div>
      <div
        aria-label="Receipts used today"
        aria-valuemax={limit}
        aria-valuemin={0}
        aria-valuenow={Math.min(used, limit)}
        aria-valuetext={`${used} of ${limit} receipts used today`}
        className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-foreground/15"
        role="meter"
      >
        <div
          className={cn("h-full rounded-full", warn ? "bg-warning" : "bg-primary")}
          style={{ width: `${ratio * 100}%` }}
        />
      </div>
      <p
        className={cn(
          "mt-2 flex items-start gap-1.5 text-xs",
          warn ? "text-warning" : "text-muted-foreground",
        )}
      >
        {warn ? <CircleAlert aria-hidden="true" className="mt-px size-3.5 shrink-0" /> : null}
        {usageNote(usage)}
      </p>
    </div>
  );
}
