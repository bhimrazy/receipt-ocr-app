import { buttonVariants } from "@receipt-ocr/ui/components/button";
import { cn } from "@receipt-ocr/ui/lib/utils";
import Link from "next/link";
import { Brand } from "@/components/brand";
import { MobileMenu } from "./mobile-menu";
import { focusRing, sectionLinks } from "./primitives";
import { SectionNav } from "./section-nav";

export function Header() {
  return (
    <header className="sticky top-0 z-40 border-b border-border/70 bg-background/85 backdrop-blur-md supports-[backdrop-filter]:bg-background/70">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-2 px-4 sm:px-6">
        <Link
          aria-label="ReceiptOCR home"
          className={cn("inline-flex min-h-11 items-center rounded-md", focusRing)}
          href="/"
        >
          <Brand />
        </Link>
        <nav aria-label="Main" className="hidden lg:block">
          <SectionNav links={sectionLinks} />
        </nav>
        <div className="flex items-center gap-1">
          <Link
            className={cn(
              "hidden min-h-11 items-center rounded-md px-3 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground sm:inline-flex",
              focusRing,
            )}
            href="/sign-in"
          >
            Sign in
          </Link>
          <Link className={cn(buttonVariants(), "h-11 px-4")} href="/sign-up">
            Start free
          </Link>
          <MobileMenu links={sectionLinks} />
        </div>
      </div>
    </header>
  );
}
