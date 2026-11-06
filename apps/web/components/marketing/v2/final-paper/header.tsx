import { buttonVariants } from "@receipt-ocr/ui/components/button";
import { cn } from "@receipt-ocr/ui/lib/utils";
import Link from "next/link";
import { MobileMenu } from "./mobile-menu";
import { Wordmark, focusRing } from "./primitives";

export const navLinks = [
  { href: "#output", label: "What you get" },
  { href: "#how", label: "How it works" },
  { href: "#data", label: "Your data" },
  { href: "#pricing", label: "Pricing" },
  { href: "#faq", label: "FAQ" },
];

export function HeaderPaper() {
  return (
    // Opaque on purpose: a see-through bar let page text show behind the nav.
    <header className="sticky top-0 z-40 border-b border-border bg-background">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-2 px-4 sm:px-6">
        <Link
          aria-label="receiptOCR home"
          className={cn("inline-flex min-h-11 items-center rounded-md", focusRing)}
          href="/"
        >
          <Wordmark />
        </Link>
        <nav aria-label="Main" className="hidden lg:block">
          <ul className="flex items-center gap-1">
            {navLinks.map((link) => (
              <li key={link.href}>
                <a
                  className={cn(
                    "inline-flex min-h-11 items-center rounded-md px-3 text-sm text-muted-foreground transition-colors hover:text-foreground",
                    focusRing,
                  )}
                  href={link.href}
                >
                  {link.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <div className="flex items-center gap-1">
          <Link
            className={cn(
              "hidden min-h-11 items-center rounded-md px-3 text-sm font-medium sm:inline-flex",
              focusRing,
            )}
            href="/sign-in"
          >
            Sign in
          </Link>
          <Link
            className={cn(
              buttonVariants({ size: "default" }),
              "h-11 px-4 shadow-none hover:translate-y-0 hover:shadow-none",
            )}
            href="/sign-up"
          >
            Start free
          </Link>
          <MobileMenu links={navLinks} />
        </div>
      </div>
    </header>
  );
}
