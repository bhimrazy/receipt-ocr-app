import { cn } from "@receipt-ocr/ui/lib/utils";
import Link from "next/link";

/** One headline number with a label and a plain-words note under it. */
export function Stat({
  label,
  value,
  note,
  href,
  tone = "default",
  className,
}: {
  label: string;
  value: number | string;
  note?: React.ReactNode;
  href?: string;
  tone?: "default" | "warning" | "destructive";
  className?: string;
}) {
  const body = (
    <>
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="mt-2 font-mono text-2xl font-semibold tabular-nums text-foreground">
        {typeof value === "number" ? value.toLocaleString("en-US") : value}
      </dd>
      {note ? (
        <dd
          className={cn(
            "mt-1 text-xs",
            tone === "warning" && "text-warning",
            tone === "destructive" && "text-destructive",
            tone === "default" && "text-muted-foreground",
          )}
        >
          {note}
        </dd>
      ) : null}
    </>
  );
  const frame = cn("block rounded-lg border border-border bg-card p-4", className);
  return href ? (
    <Link
      className={cn(
        frame,
        "outline-none transition hover:border-foreground/25 focus-visible:ring-2 focus-visible:ring-ring",
      )}
      href={href}
    >
      <dl>{body}</dl>
    </Link>
  ) : (
    <dl className={frame}>{body}</dl>
  );
}
