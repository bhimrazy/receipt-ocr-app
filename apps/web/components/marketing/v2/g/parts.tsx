import { cn } from "@receipt-ocr/ui/lib/utils";
import { CircleAlert, CircleCheck, Eye, Loader2, TriangleAlert } from "lucide-react";
import { tier, type Tier } from "./data";

const TIER: Record<Tier, { label: string; icon: typeof CircleCheck; className: string }> = {
  high: { label: "High", icon: CircleCheck, className: "bg-(--g-good-tint) text-(--g-good)" },
  check: { label: "Check", icon: Eye, className: "bg-(--g-warn-tint) text-warning" },
  review: {
    label: "Review",
    icon: TriangleAlert,
    className: "bg-(--g-crit-tint) text-destructive",
  },
};

/** Confidence tier with icon, word and score, never colour alone. */
export function Confidence({ score, compact = false }: { score: number; compact?: boolean }) {
  const { label, icon: Icon, className } = TIER[tier(score)];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-[5px] px-1.5 py-0.5 text-[11px] font-medium leading-4",
        className,
      )}
    >
      <Icon aria-hidden="true" className="size-3" />
      {compact && tier(score) === "high" ? (
        <span className="sr-only">{label}</span>
      ) : (
        <span>{label}</span>
      )}
      <span className="g-mono">{score}%</span>
    </span>
  );
}

const STATUS = {
  done: { label: "Done", icon: CircleCheck, className: "text-(--g-good)" },
  reading: { label: "Reading…", icon: Loader2, className: "text-muted-foreground" },
  failed: { label: "Couldn't read", icon: CircleAlert, className: "text-destructive" },
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
        <span className="g-mono text-foreground">{index}</span>
        {label}
      </p>
      <div className="lg:col-span-9">
        <h2
          className="max-w-[22ch] text-[32px] font-semibold leading-[1.08] tracking-[-0.025em] text-balance sm:text-[44px]"
          id={id}
        >
          {title}
        </h2>
        {lede ? (
          <p className="mt-5 max-w-[60ch] text-[17px] leading-7 text-(--g-ink-2) text-pretty">
            {lede}
          </p>
        ) : null}
      </div>
    </div>
  );
}

/** Small uppercase-free caption used for figure labels: "Fig. 1  Receipt and record". */
export function Fig({ n, children }: { n: string; children: React.ReactNode }) {
  return (
    <p className="flex items-baseline gap-3 text-xs text-muted-foreground">
      <span className="g-mono shrink-0 whitespace-nowrap text-foreground">Fig. {n}</span>
      {children}
    </p>
  );
}

export const container = "mx-auto w-full max-w-[1200px] px-4 sm:px-8";
