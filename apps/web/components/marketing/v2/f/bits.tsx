import { buttonVariants } from "@receipt-ocr/ui/components/button";
import { cn } from "@receipt-ocr/ui/lib/utils";
import { ArrowRight, ReceiptText } from "lucide-react";
import Link from "next/link";

export const ring =
  "outline-none focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

export function FBrand() {
  return (
    <span className="flex items-center gap-2">
      <span className="flex size-9 -rotate-6 items-center justify-center rounded-xl border-2 border-foreground bg-[var(--f-yellow)] text-[var(--f-ink)]">
        <ReceiptText aria-hidden className="size-5" strokeWidth={2.5} />
      </span>
      <span className="text-xl font-extrabold tracking-tight">ReceiptOCR</span>
    </span>
  );
}

/** Primary CTA. Colours come from the section's --primary tokens. */
export function StartFree({
  className,
  label = "Start free",
}: {
  className?: string;
  label?: string;
}) {
  return (
    <Link
      className={cn(
        buttonVariants({ size: "lg" }),
        "f-btn h-14 gap-2.5 rounded-full border-2 border-[var(--f-ink)] px-7 text-lg font-bold hover:translate-y-0 max-md:h-14",
        ring,
        className,
      )}
      href="/sign-up"
    >
      {label}
      <ArrowRight aria-hidden className="size-5" strokeWidth={2.75} />
    </Link>
  );
}

export function Kicker({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <p
      className={cn(
        "inline-flex items-center rounded-full border-2 border-foreground px-3.5 py-1 text-sm font-bold",
        className,
      )}
    >
      {children}
    </p>
  );
}
