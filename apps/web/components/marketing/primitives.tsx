import { buttonVariants } from "@receipt-ocr/ui/components/button";
import { cn } from "@receipt-ocr/ui/lib/utils";
import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { freePlan } from "./content";

export function Eyebrow({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <p className={cn("font-mono text-xs uppercase tracking-[0.22em] text-primary", className)}>
      {children}
    </p>
  );
}

/** Primary sign-up CTA plus the reassurance line; full width on phones. */
export function SignUpCta({
  className,
  secondary,
  align = "start",
}: {
  className?: string;
  secondary?: { href: string; label: string };
  align?: "start" | "center";
}) {
  return (
    <div className={cn("flex flex-col gap-4", align === "center" && "items-center", className)}>
      <div
        className={cn(
          "flex w-full flex-col gap-3 sm:w-auto sm:flex-row",
          align === "center" && "sm:justify-center",
        )}
      >
        <Link className={cn(buttonVariants({ size: "lg" }), "w-full sm:w-auto")} href="/sign-up">
          Get started free <ArrowRight aria-hidden className="size-4" />
        </Link>
        {secondary && (
          <a
            className={cn(buttonVariants({ size: "lg", variant: "outline" }), "w-full sm:w-auto")}
            href={secondary.href}
          >
            {secondary.label}
          </a>
        )}
      </div>
      <p className="font-mono text-xs text-muted-foreground">
        Free · No card required · {freePlan.receiptsPerDay} receipts a day
      </p>
    </div>
  );
}

export function BackdropGrid({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn("grid-mask pointer-events-none absolute inset-0 opacity-40", className)}
    >
      <div className="receipt-grid absolute -inset-1" />
    </div>
  );
}
