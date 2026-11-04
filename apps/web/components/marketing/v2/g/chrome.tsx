import { buttonVariants } from "@receipt-ocr/ui/components/button";
import { cn } from "@receipt-ocr/ui/lib/utils";
import Link from "next/link";
import { container } from "./parts";

/** Flat buttons: the shared primary glow and lift don't belong on a light, quiet page. */
export const ctaClass = cn(
  buttonVariants({ size: "lg" }),
  "h-12 rounded-lg px-5 shadow-none hover:translate-y-0 hover:bg-(--g-primary-hover) hover:shadow-none",
);
export const ghostClass = cn(
  buttonVariants({ size: "lg", variant: "outline" }),
  "h-12 rounded-lg border-(--g-rule-strong) bg-card px-5 hover:bg-muted",
);

function Wordmark() {
  return (
    <Link
      className="flex min-h-11 items-center gap-2 rounded-md text-[15px] font-semibold text-foreground tracking-[-0.01em] outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      href="/"
    >
      {/* A receipt outline with one ruled line: the mark. */}
      <svg aria-hidden="true" className="size-5 text-primary" fill="none" viewBox="0 0 20 20">
        <path
          d="M4 2.5h12v15l-2-1.25-2 1.25-2-1.25-2 1.25-2-1.25-2 1.25z"
          stroke="currentColor"
          strokeLinejoin="round"
          strokeWidth="1.5"
        />
        <path d="M7 7h6M7 10h6M7 13h3" stroke="currentColor" strokeWidth="1.5" />
      </svg>
      receiptOCR
    </Link>
  );
}

const nav = [
  { href: "#how", label: "How it works" },
  { href: "#data", label: "Your data" },
  { href: "#pricing", label: "Pricing" },
  { href: "#faq", label: "FAQ" },
];

const linkClass =
  "inline-flex min-h-11 items-center rounded-md px-3 text-sm text-(--g-ink-2) outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring";

export function Header() {
  return (
    <header className="sticky top-0 z-30 border-b border-border bg-background/90 backdrop-blur-sm supports-[backdrop-filter]:bg-background/80">
      <div className={cn(container, "flex h-16 items-center justify-between gap-4")}>
        <Wordmark />
        <nav aria-label="Sections" className="hidden items-center md:flex">
          {nav.map((item) => (
            <a className={linkClass} href={item.href} key={item.href}>
              {item.label}
            </a>
          ))}
        </nav>
        <div className="flex items-center gap-1 sm:gap-2">
          <Link className={linkClass} href="/sign-in">
            Sign in
          </Link>
          <Link className={cn(ctaClass, "h-10 px-4 text-sm max-md:h-11")} href="/sign-up">
            Start free
          </Link>
        </div>
      </div>
    </header>
  );
}

export function Footer() {
  return (
    <footer className="border-t border-border">
      <div
        className={cn(
          container,
          "flex flex-col gap-6 py-10 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between",
        )}
      >
        <div className="flex flex-col gap-1">
          <Wordmark />
          <p>Receipts into records, for small businesses and their bookkeepers.</p>
        </div>
        <nav aria-label="Footer" className="-mx-3 flex flex-wrap">
          <Link className={linkClass} href="/privacy">
            Privacy
          </Link>
          <Link className={linkClass} href="/terms">
            Terms
          </Link>
          <Link className={linkClass} href="/sign-in">
            Sign in
          </Link>
          <span className="inline-flex min-h-11 items-center px-3 g-num">© 2026 receiptOCR</span>
        </nav>
      </div>
    </footer>
  );
}
