import { cn } from "@receipt-ocr/ui/lib/utils";
import { CircleAlert, CircleCheck, Eye, Loader2, TriangleAlert } from "lucide-react";
import { tier, type Tier } from "./data";

const TIER: Record<Tier, { label: string; icon: typeof CircleCheck; className: string }> = {
  high: { label: "High", icon: CircleCheck, className: "bg-(--fl-primary-tint) text-primary" },
  check: { label: "Check", icon: Eye, className: "bg-(--fl-warn-tint) text-warning" },
  review: {
    label: "Review",
    icon: TriangleAlert,
    className: "bg-(--fl-crit-tint) text-destructive",
  },
};

/** Receipt-level confidence tier, as the app's ConfidenceBadge: icon, word, then the score. */
export function Confidence({ score }: { score: number }) {
  const { label, icon: Icon, className } = TIER[tier(score)];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-[5px] px-1.5 py-0.5 text-xs font-medium leading-4 whitespace-nowrap",
        className,
      )}
    >
      <Icon aria-hidden="true" className="size-3" />
      {label}
      <span className="fl-mono opacity-80">{score}%</span>
    </span>
  );
}

/**
 * Receipt-level badge. A receipt with any line in the review tier leads with the work left
 * ("1 line to check") rather than a reassuring overall score.
 */
export function ReceiptBadge({ confidence, toCheck }: { confidence: number; toCheck: number }) {
  if (toCheck === 0) return <Confidence score={confidence} />;
  return (
    <span className="inline-flex items-center gap-1 rounded-[5px] bg-(--fl-warn-tint) px-1.5 py-0.5 text-xs font-medium leading-4 whitespace-nowrap text-warning">
      <Eye aria-hidden="true" className="size-3" />
      {toCheck} {toCheck === 1 ? "line" : "lines"} to check
    </span>
  );
}

/**
 * Line-item confidence. Sure lines get a quiet tick and score; a low line leads with the plain
 * instruction and keeps the score secondary.
 */
export function LineFlag({ score, short = false }: { score: number; short?: boolean }) {
  const level = tier(score);
  if (level === "high") {
    return (
      <span className="inline-flex items-center gap-1 text-xs whitespace-nowrap text-muted-foreground">
        <CircleCheck aria-hidden="true" className="size-3 text-primary" />
        <span className="sr-only">High confidence</span>
        <span className="fl-mono">{score}%</span>
      </span>
    );
  }
  const review = level === "review";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-[5px] px-1.5 py-0.5 text-xs font-medium whitespace-nowrap",
        review ? "bg-(--fl-crit-tint) text-destructive" : "bg-(--fl-warn-tint) text-warning",
      )}
    >
      {review ? (
        <TriangleAlert aria-hidden="true" className="size-3" />
      ) : (
        <Eye aria-hidden="true" className="size-3" />
      )}
      {review ? (short ? "Check" : "Check this line") : "Worth a look"}
      <span className="fl-mono font-normal opacity-75">{score}%</span>
    </span>
  );
}

const STATUS = {
  done: { label: "Done", icon: CircleCheck, className: "text-primary" },
  reading: { label: "Scanning…", icon: Loader2, className: "text-muted-foreground" },
  failed: { label: "Couldn't scan", icon: CircleAlert, className: "text-destructive" },
} as const;

export function Status({ status }: { status: keyof typeof STATUS }) {
  const { label, icon: Icon, className } = STATUS[status];
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-xs font-medium", className)}>
      <Icon
        aria-hidden="true"
        className={cn(
          "size-3.5",
          status === "reading" && "animate-spin [animation-duration:2s] motion-reduce:animate-none",
        )}
      />
      {label}
    </span>
  );
}

/**
 * Swiss section head: a numbered index in the first three columns, the headline and lede in the
 * rest. Stacks below lg.
 */
export function SectionHead({
  index,
  label,
  title,
  lede,
  id,
}: {
  index: string;
  label: string;
  title: React.ReactNode;
  lede?: React.ReactNode;
  id: string;
}) {
  return (
    <div className="grid gap-x-6 gap-y-4 border-t border-foreground pt-5 lg:grid-cols-12">
      <p className="flex gap-3 text-sm text-muted-foreground lg:col-span-3">
        <span className="fl-mono text-foreground">{index}</span>
        {label}
      </p>
      <div className="lg:col-span-9">
        <h2
          className="max-w-[22ch] text-[32px] font-semibold leading-[1.06] tracking-[-0.03em] text-balance sm:text-[44px]"
          id={id}
        >
          {title}
        </h2>
        {lede ? (
          <p className="mt-5 max-w-[60ch] text-[17px] leading-7 text-(--fl-ink-2) text-pretty">
            {lede}
          </p>
        ) : null}
      </div>
    </div>
  );
}

/** Figure caption: "Fig. 2  Workspace history". */
export function Fig({ n, children }: { n: string; children: React.ReactNode }) {
  return (
    <p className="flex items-baseline gap-3 text-xs text-muted-foreground">
      <span className="fl-mono shrink-0 whitespace-nowrap text-foreground">Fig. {n}</span>
      {children}
    </p>
  );
}

export function ComingTag() {
  return (
    <span className="rounded-[4px] border border-(--fl-rule-strong) px-1.5 py-px text-xs font-medium text-muted-foreground">
      Coming
    </span>
  );
}

export const container = "mx-auto w-full max-w-[1200px] px-4 sm:px-8";
