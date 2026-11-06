import { buttonVariants } from "@receipt-ocr/ui/components/button";
import { cn } from "@receipt-ocr/ui/lib/utils";
import { ArrowRight } from "lucide-react";
import Link from "next/link";

/** Page sections in page order. Each label matches the section's eyebrow. */
export const sectionLinks = [
  { href: "#how", label: "How it works" },
  { href: "#output", label: "Export" },
  { href: "#data", label: "Privacy" },
  { href: "#pricing", label: "Pricing" },
  { href: "#faq", label: "FAQ" },
];

export const focusRing =
  "outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

const titleId = (sectionId: string) => `${sectionId}-title`;

/**
 * The shared section shell: one width and rhythm for every band. The anchor id sits on the
 * section, so a jump lands on the whole band (html scroll-padding clears the sticky header).
 */
export function Section({
  id,
  className,
  children,
}: {
  id: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section
      aria-labelledby={titleId(id)}
      className={cn("border-t border-border", className)}
      id={id}
    >
      <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 lg:py-28">{children}</div>
    </section>
  );
}

export function Label({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <p className={cn("font-mono text-xs tracking-[0.2em] text-primary uppercase", className)}>
      {children}
    </p>
  );
}

/** `id` is the enclosing Section's id; the h2 gets titleId(id). */
export function SectionHead({
  id,
  label,
  title,
  lead,
  className,
}: {
  id: string;
  label: string;
  title: React.ReactNode;
  lead?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("max-w-2xl", className)}>
      <Label>{label}</Label>
      <h2
        className="fc-display mt-4 text-[2.1rem] leading-[1.08] font-bold text-balance sm:text-[2.75rem]"
        id={titleId(id)}
      >
        {title}
      </h2>
      {lead && (
        <p className="mt-4 text-lg leading-relaxed text-pretty text-muted-foreground">{lead}</p>
      )}
    </div>
  );
}

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
    <div className={cn("flex flex-col gap-3 sm:flex-row sm:flex-wrap", className)}>
      <Link className={cn(buttonVariants({ size: "lg" }), "px-6 text-[0.95rem]")} href="/sign-up">
        Start free
        <ArrowRight
          aria-hidden
          className="transition-transform motion-safe:group-hover/button:translate-x-0.5"
        />
      </Link>
      <a
        className={cn(buttonVariants({ variant: "outline", size: "lg" }), "px-6 text-[0.95rem]")}
        href={secondaryHref}
      >
        {secondaryLabel}
      </a>
    </div>
  );
}
