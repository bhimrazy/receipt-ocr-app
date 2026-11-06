import { buttonVariants } from "@receipt-ocr/ui/components/button";
import { cn } from "@receipt-ocr/ui/lib/utils";
import { ArrowRight } from "lucide-react";
import Link from "next/link";

export const focusRing =
  "outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

// The shared button, minus its dark-theme glow: on paper a pressed-ink shadow reads better.
const primary = cn(
  buttonVariants({ size: "lg" }),
  "h-12 px-6 text-[0.95rem] shadow-[0_1px_0_rgb(31_27_22/0.2),0_6px_16px_-8px_rgb(31_27_22/0.6)] hover:shadow-[0_1px_0_rgb(31_27_22/0.2),0_10px_22px_-8px_rgb(31_27_22/0.6)]",
);
const secondary = cn(
  buttonVariants({ variant: "ghost", size: "lg" }),
  "h-12 px-1 text-[0.95rem] text-foreground underline sm:px-4 decoration-[var(--input)] decoration-1 underline-offset-[6px] hover:bg-transparent hover:decoration-foreground",
);

export function Ctas({
  className,
  secondaryHref = "#output",
  secondaryLabel = "See a sample export",
}: {
  className?: string;
  secondaryHref?: string;
  secondaryLabel?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-center gap-x-2 gap-y-3", className)}>
      <Link className={primary} href="/sign-up">
        Start free
        <ArrowRight
          aria-hidden
          className="transition-transform group-hover/button:translate-x-0.5"
        />
      </Link>
      <a className={secondary} href={secondaryHref}>
        {secondaryLabel}
      </a>
    </div>
  );
}

export function Eyebrow({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <p
      className={cn(
        "pp-mono text-[0.75rem] font-medium uppercase tracking-[0.16em] text-muted-foreground",
        className,
      )}
    >
      {children}
    </p>
  );
}

export function SectionHead({
  id,
  eyebrow,
  title,
  lead,
  className,
}: {
  id: string;
  eyebrow: string;
  title: React.ReactNode;
  lead?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("max-w-2xl", className)}>
      <Eyebrow>{eyebrow}</Eyebrow>
      <h2
        id={id}
        className="pp-display mt-4 text-[2.25rem] leading-[1.05] text-balance sm:text-5xl"
      >
        {title}
      </h2>
      {lead && (
        <p className="mt-5 text-lg leading-relaxed text-pretty text-muted-foreground">{lead}</p>
      )}
    </div>
  );
}

/** Hand-drawn underline in stamp ink. */
export function Scribble({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden
      className={className}
      fill="none"
      preserveAspectRatio="none"
      viewBox="0 0 300 20"
    >
      <path
        className="pp-draw"
        d="M4 13c40-7 92-9 148-7 50 2 98 5 144 1M30 17c60-4 140-5 230-3"
        stroke="var(--pp-accent)"
        strokeLinecap="round"
        strokeWidth="3.5"
      />
    </svg>
  );
}

/** A pen tick, for lists. */
export function Tick({ className }: { className?: string }) {
  return (
    <svg aria-hidden className={cn("size-4 shrink-0", className)} fill="none" viewBox="0 0 16 16">
      <path
        d="M2.5 8.6c1.3 1 2.4 2.2 3.3 3.7C7.6 8.4 10.2 5.3 13.6 3"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </svg>
  );
}

export function Wordmark() {
  return (
    <span className="flex items-center gap-2">
      <svg aria-hidden className="h-7 w-5" fill="none" viewBox="0 0 20 28">
        <path
          d="M2 1h16v24l-2.67-2-2.66 2L10 23l-2.67 2-2.66-2L2 25V1Z"
          fill="var(--card)"
          stroke="currentColor"
          strokeLinejoin="round"
          strokeWidth="1.5"
        />
        <path
          d="M6 7h8M6 11h8M6 15h5"
          stroke="currentColor"
          strokeLinecap="round"
          strokeWidth="1.5"
        />
        <circle cx="14" cy="17.5" fill="var(--pp-accent)" r="1.6" />
      </svg>
      <span className="pp-display text-xl tracking-tight">
        receipt<span className="pp-mono text-[0.95rem] font-medium tracking-normal">OCR</span>
      </span>
    </span>
  );
}
