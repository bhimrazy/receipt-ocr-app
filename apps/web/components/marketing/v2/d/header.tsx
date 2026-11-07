import { buttonVariants } from "@receipt-ocr/ui/components/button";
import { cn } from "@receipt-ocr/ui/lib/utils";
import Link from "next/link";
import { Wordmark, focusRing } from "./primitives";

const links = [
  { href: "#output", label: "What you get" },
  { href: "#how", label: "How it works" },
  { href: "#data", label: "Your data" },
  { href: "#pricing", label: "Pricing" },
  { href: "#faq", label: "FAQ" },
];

export function HeaderD() {
  return (
    <header className="sticky top-0 z-40 border-b border-border/70 bg-background/95">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-4 sm:px-6">
        <Link
          aria-label="ReceiptOCR home"
          className={cn("inline-flex min-h-11 items-center rounded-md", focusRing)}
          href="/"
        >
          <Wordmark />
        </Link>
        <nav aria-label="Main" className="hidden lg:block">
          <ul className="flex items-center gap-1">
            {links.map((link) => (
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
              "inline-flex min-h-11 items-center rounded-md px-3 text-sm font-medium",
              focusRing,
            )}
            href="/sign-in"
          >
            Sign in
          </Link>
          <Link
            className={cn(
              buttonVariants({ size: "default" }),
              "h-11 px-4 shadow-none hover:shadow-none",
            )}
            href="/sign-up"
          >
            Start free
          </Link>
        </div>
      </div>
    </header>
  );
}
