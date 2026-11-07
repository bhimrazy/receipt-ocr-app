import { cn } from "@receipt-ocr/ui/lib/utils";

/**
 * The Scan line mark: a receipt crossed by a bar that overshoots both edges. Keep the overshoot in
 * every drawing. Sources are in apps/web/brand; `small` is the heavier drawing for 24px and under.
 */
export function BrandMark({ small = false, className }: { small?: boolean; className?: string }) {
  return (
    <svg
      viewBox={small ? "-1 -1 26 26" : "0 0 24 24"}
      fill="none"
      stroke="currentColor"
      strokeWidth={small ? 2.6 : 2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={cn("size-4", className)}
    >
      {small ? (
        <>
          <path d="M6 3h12v18l-3-2-3 2-3-2-3 2z" />
          <path d="M1.5 11.5h21" strokeWidth={3.4} />
        </>
      ) : (
        <>
          <path d="M6 3h9l3 3v15l-2-1.3-2 1.3-2-1.3-2 1.3-2-1.3-2 1.3z" />
          <path d="M15 3v3h3" />
          <path d="M9 7.5h4" />
          <path d="M2.5 11.5h19" strokeWidth={2.6} />
          <path d="M9 15.5h5" opacity={0.45} />
        </>
      )}
    </svg>
  );
}

export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <div className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-[0_0_24px_color-mix(in_oklab,var(--primary)_30%,transparent)]">
        <BrandMark small className="size-[22px]" />
      </div>
      {!compact && (
        <span className="font-mono text-sm font-semibold tracking-tight">
          Receipt<span className="text-primary">OCR</span>
        </span>
      )}
    </div>
  );
}
