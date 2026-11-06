import { cn } from "@receipt-ocr/ui/lib/utils";
import { Menu } from "lucide-react";
import Link from "next/link";
import { FBrand, ring } from "./bits";
import { nav } from "./copy";

const navLink = cn(
  "inline-flex min-h-11 items-center rounded-full px-4 text-[15px] font-bold transition-colors hover:bg-foreground hover:text-background",
  ring,
);

/** Static header on the tangerine hero. The mobile menu is a native <details>, so it needs no JS. */
export function FHeader() {
  return (
    <header className="relative z-20 px-4 pt-4 sm:px-6">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3">
        <Link
          aria-label="receiptOCR home"
          className={cn("inline-flex min-h-11 items-center rounded-xl", ring)}
          href="/landing-f"
        >
          <FBrand />
        </Link>

        <nav aria-label="Main" className="hidden items-center gap-1 lg:flex">
          {nav.map((link) => (
            <a className={navLink} href={link.href} key={link.href}>
              {link.label}
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-1">
          <Link className={navLink} href="/sign-in">
            Sign in
          </Link>
          <Link
            className={cn(
              "f-btn hidden min-h-11 items-center rounded-full border-2 border-foreground bg-foreground px-5 text-[15px] font-bold text-background sm:inline-flex",
              ring,
            )}
            href="/sign-up"
          >
            Start free
          </Link>
          <details className="group relative lg:hidden [&_summary::-webkit-details-marker]:hidden">
            <summary
              aria-label="Menu"
              className={cn(
                "ml-1 flex size-11 cursor-pointer list-none items-center justify-center rounded-full border-2 border-foreground group-open:bg-foreground group-open:text-background",
                ring,
              )}
            >
              <Menu aria-hidden className="size-5" strokeWidth={2.5} />
            </summary>
            <nav
              aria-label="Sections"
              className="f-pop absolute right-0 top-14 flex w-60 flex-col gap-1 rounded-3xl border-2 border-foreground bg-[var(--f-cream)] p-2 text-[var(--f-ink)]"
            >
              {nav.map((link) => (
                <a
                  className={cn(
                    "flex min-h-12 items-center rounded-2xl px-4 text-base font-bold hover:bg-[var(--f-yellow)]",
                    ring,
                  )}
                  href={link.href}
                  key={link.href}
                >
                  {link.label}
                </a>
              ))}
              <Link
                className={cn(
                  "mt-1 flex min-h-12 items-center justify-center rounded-2xl bg-[var(--f-ink)] px-4 text-base font-bold text-[var(--f-cream)]",
                  ring,
                )}
                href="/sign-up"
              >
                Start free
              </Link>
            </nav>
          </details>
        </div>
      </div>
    </header>
  );
}
