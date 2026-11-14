import { Badge } from "@receipt-ocr/ui/components/badge";
import { cn } from "@receipt-ocr/ui/lib/utils";
import { CircleAlert } from "lucide-react";
import { formatTime } from "@/lib/format";
import { NEAR_RATIO, usageRatio } from "@/lib/upgrade-level";

export type Usage = {
  /** The month when the plan has a monthly limit, else the day. */
  period: "day" | "month";
  /** Whose usage: the person's (across their workspaces on the plan) or the workspace's. */
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

/** The window `usageRemaining` comes from: the month when it is the tighter limit. */
export function remainingSpan(usage: Usage): "today" | "this month" {
  if (usage.period === "day") return "today";
  return usageRemaining(usage) === Math.max(0, usage.limit - usage.used) ? "this month" : "today";
}

/** Today's limit is NEAR_RATIO used, on a plan whose meter shows the month. */
const dayNear = (usage: Usage) => usage.day !== undefined && usageRatio(usage.day) >= NEAR_RATIO;

/**
 * Whether the bar (the month, or the day on a plan without one) is amber: from NEAR_RATIO used,
 * or once that window is used up. A used-up day leaves a month bar as it is.
 */
const barWarns = (usage: Usage) =>
  usageRatio(usage) >= NEAR_RATIO ||
  usage.blocked === "month" ||
  (usage.period === "day" && usage.blocked === "day");

/** Whether the note warns (amber icon): any refusal, or either window from NEAR_RATIO. */
export const usageWarns = (usage: Usage) =>
  usage.blocked !== null || usageRatio(usage) >= NEAR_RATIO || dayNear(usage);

const resetDay = (date: Date) =>
  date.toLocaleDateString("en-GB", { day: "numeric", month: "long", timeZone: "UTC" });

/** "1 Dec", the meter's short date. */
const shortDay = (date: Date) =>
  date.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

/** The full sentence about the room left, with the UTC reset time: Billing and the upload panel. */
export function usageNote(usage: Usage): string {
  const { used, limit, blocked, period } = usage;
  const opens = formatTime(usage.opensAt);
  if (blocked === "global") return `Scanning is paused for everyone until ${opens}.`;
  if (blocked === "pool")
    return `Free scanning is busy today (shared capacity). Try again after ${opens}.`;
  const left = Math.max(0, limit - used);
  if (period === "month") {
    const reset = `${resetDay(usage.resetsAt)}, 00:00 UTC`;
    if (blocked === "month" || left === 0) return `Limit reached. Uploads open on ${reset}.`;
    if (blocked === "day")
      return `Today's limit reached. Uploads open at ${opens}. ${left} left this month.`;
    return dayNear(usage)
      ? `${usageRemaining(usage)} left today, ${left} this month. Resets ${reset}.`
      : `${left} left this month. Resets ${reset}.`;
  }
  const reset = formatTime(usage.resetsAt);
  if (blocked === "day" || left === 0) return `Limit reached. Uploads open at ${reset}.`;
  return `${left} left today. Resets at ${reset}.`;
}

/**
 * The card's one line, first match wins: paused for everyone, the Free pool, the month used up,
 * the day used up, the day from NEAR_RATIO, the month from NEAR_RATIO (with its reset date),
 * then the month's room. Short on purpose; Billing has the full sentence.
 */
export function meterNote(usage: Usage): string {
  const { used, limit, blocked, period } = usage;
  if (blocked === "global") return `Paused for everyone · opens ${formatTime(usage.opensAt)}`;
  if (blocked === "pool") return `Free scanning busy · opens ${formatTime(usage.opensAt)}`;
  const left = Math.max(0, limit - used);
  if (period === "day") {
    return blocked === "day" || left === 0
      ? `Limit reached · opens ${formatTime(usage.resetsAt)}`
      : `${left} left today`;
  }
  if (blocked === "month" || left === 0) return `Limit reached · opens ${shortDay(usage.resetsAt)}`;
  if (blocked === "day") return `Today's limit reached · opens ${formatTime(usage.opensAt)}`;
  if (dayNear(usage)) return `${usageRemaining(usage)} left today`;
  return usageRatio(usage) >= NEAR_RATIO
    ? `${left} left · resets ${shortDay(usage.resetsAt)}`
    : `${left} left this month`;
}

/**
 * The phone strip's line from NEAR_RATIO of either window, while uploads are open: the day when
 * it is near, else the month with its reset date. Null below that.
 */
export function stripNote(usage: Usage): string | null {
  if (usage.blocked) return null;
  const scans = (n: number) => `${n} ${n === 1 ? "scan" : "scans"}`;
  if (dayNear(usage) || (usage.period === "day" && usageRatio(usage) >= NEAR_RATIO))
    return `${scans(usageRemaining(usage))} left today`;
  if (usageRatio(usage) < NEAR_RATIO) return null;
  return `${scans(Math.max(0, usage.limit - usage.used))} left this month · resets ${shortDay(usage.resetsAt)}`;
}

/**
 * Scans used against the plan limit: plan badge, count, bar and one line. Amber on the bar and
 * icon only, from NEAR_RATIO, and the words say it too. `detail` (Billing) gives the full
 * sentence; `action` goes under the note.
 */
export function UsageMeter({
  usage,
  plan,
  className,
  action,
  detail = false,
}: {
  usage: Usage;
  plan: "free" | "pro";
  className?: string;
  action?: React.ReactNode;
  detail?: boolean;
}) {
  const { used, limit } = usage;
  const ratio = usageRatio(usage);
  const warn = usageWarns(usage);
  const barWarn = barWarns(usage);
  const span = usage.period === "month" ? "this month" : "today";

  return (
    <div className={cn("rounded-lg border border-border bg-card p-3.5", className)}>
      <div className="flex items-center justify-between gap-2">
        <PlanBadge plan={plan} />
        <p className="font-mono text-xs whitespace-nowrap text-muted-foreground tabular-nums">
          <span className="text-sm font-semibold text-foreground">{used}</span> / {limit} scans
        </p>
      </div>
      <div
        aria-label={`Scans used ${span}`}
        aria-valuemax={limit}
        aria-valuemin={0}
        aria-valuenow={Math.min(used, limit)}
        aria-valuetext={`${used} of ${limit} scans used ${span}`}
        className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-foreground/15"
        role="meter"
      >
        <div
          className={cn("h-full rounded-full", barWarn ? "bg-warning" : "bg-primary")}
          style={{ width: `${ratio * 100}%` }}
        />
      </div>
      <p
        className={cn(
          "mt-2 flex items-start gap-1.5 text-xs",
          warn ? "text-foreground" : "text-muted-foreground",
        )}
      >
        {warn ? (
          <CircleAlert aria-hidden="true" className="mt-px size-3.5 shrink-0 text-warning" />
        ) : null}
        <span>{detail ? usageNote(usage) : meterNote(usage)}</span>
      </p>
      {action ? <div className="mt-3 flex flex-col">{action}</div> : null}
    </div>
  );
}

/** One badge for a plan everywhere: secondary for Free, the accent for Pro. */
export function PlanBadge({ plan, className }: { plan: "free" | "pro"; className?: string }) {
  return (
    <Badge className={className} variant={plan === "pro" ? "default" : "secondary"}>
      {plan === "pro" ? "Pro" : "Free"}
    </Badge>
  );
}
