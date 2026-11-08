import { cn } from "@receipt-ocr/ui/lib/utils";
import { CircleAlert } from "lucide-react";
import { formatTime } from "@/lib/format";

export type Usage = {
  /** The month when the plan has a monthly limit, else the day. */
  period: "day" | "month";
  /** Whose usage: the person's (Free, across their workspaces) or the workspace's (Pro). */
  scope: "user" | "workspace";
  used: number;
  limit: number;
  /** When `period` resets. */
  resetsAt: Date;
  /** With a monthly limit: today's count and limit too. */
  day?: { used: number; limit: number };
  /**
   * Why uploads are refused right now. `pool` is the Free plan's shared daily
   * capacity. The per-minute burst limit clears itself, so it isn't reported.
   */
  blocked: "day" | "month" | "pool" | "global" | null;
  /** When uploads open again while blocked: midnight UTC, or the month's reset. */
  opensAt: Date;
};

/** Scans the next upload batch can still use: the tighter of the month and the day. */
export function usageRemaining({ used, limit, day }: Usage): number {
  const left = Math.max(0, limit - used);
  return day ? Math.min(left, Math.max(0, day.limit - day.used)) : left;
}

const resetDay = (date: Date) =>
  date.toLocaleDateString("en-GB", { day: "numeric", month: "long", timeZone: "UTC" });

/** The one line that says how much room is left, shared by the meter and the upload panel. */
export function usageNote(usage: Usage): string {
  const { used, limit, blocked, period } = usage;
  const opens = formatTime(usage.opensAt);
  if (blocked === "global") return `Scanning is paused for everyone until ${opens}.`;
  if (blocked === "pool") return `Free scanning is busy today. Try again after ${opens}.`;
  const left = Math.max(0, limit - used);
  if (period === "month") {
    const reset = `${resetDay(usage.resetsAt)}, 00:00 UTC`;
    if (blocked === "month" || left === 0) return `Monthly limit reached. Resets on ${reset}.`;
    if (blocked === "day")
      return `Daily limit reached. Resets at ${opens}. ${left} left this month.`;
    return `${usageRemaining(usage)} left today, ${left} this month. The month resets on ${reset}.`;
  }
  const reset = formatTime(usage.resetsAt);
  if (blocked === "day" || left === 0) return `Daily limit reached. Resets at ${reset}.`;
  return `${left} left today. Resets at ${reset}.`;
}

/** Receipts used against the plan limit. Amber from 80%, with words, not colour alone. */
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
  const span = usage.period === "month" ? "this month" : "today";

  return (
    <div className={cn("rounded-lg border border-border bg-card p-3.5", className)}>
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-xs text-muted-foreground">{planLabel}</p>
        <p className="font-mono text-xs text-muted-foreground tabular-nums">
          <span className="text-sm font-semibold text-foreground">{used}</span> / {limit} {span}
        </p>
      </div>
      <div
        aria-label={`Receipts used ${span}`}
        aria-valuemax={limit}
        aria-valuemin={0}
        aria-valuenow={Math.min(used, limit)}
        aria-valuetext={`${used} of ${limit} receipts used ${span}`}
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
