import { cn } from "@receipt-ocr/ui/lib/utils";
import Link from "next/link";
import { Brand } from "@/components/brand";

const columns: Array<{ title: string; links: Array<{ label: string; href: string }> }> = [
  {
    title: "Product",
    links: [
      { label: "How it works", href: "/#how" },
      { label: "Features", href: "/#features" },
      { label: "Pricing", href: "/#pricing" },
      { label: "FAQ", href: "/#faq" },
    ],
  },
  {
    title: "Account",
    links: [
      { label: "Create a free account", href: "/sign-up" },
      { label: "Sign in", href: "/sign-in" },
    ],
  },
  {
    title: "Legal",
    links: [
      { label: "Privacy", href: "/privacy" },
      { label: "Terms", href: "/terms" },
    ],
  },
];

const linkClass =
  "inline-flex min-h-11 items-center rounded-md text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:min-h-8";

/** `narrow` matches the max-w-3xl column of legal and error pages. */
export function SiteFooter({ narrow = false }: { narrow?: boolean }) {
  return (
    <footer className="border-t border-border px-5 pb-10 pt-14">
      <div className={cn("mx-auto", narrow ? "max-w-3xl" : "max-w-6xl")}>
        <div
          className={cn(
            "grid grid-cols-2 gap-x-6 gap-y-8",
            narrow ? "sm:grid-cols-3" : "md:grid-cols-[1.5fr_repeat(3,1fr)]",
          )}
        >
          {!narrow && (
            <div className="col-span-2 max-w-xs md:col-span-1">
              <Brand />
              <p className="mt-4 text-sm leading-6 text-muted-foreground">
                Receipts in, spreadsheet out. Check every number before it reaches your books.
              </p>
            </div>
          )}
          {columns.map((column) => (
            <div key={column.title}>
              <h2 className="font-mono text-xs uppercase tracking-[0.18em] text-muted-foreground">
                {column.title}
              </h2>
              <ul className="mt-3 flex flex-col text-sm md:gap-1">
                {column.links.map((link) => (
                  <li key={link.label}>
                    <Link className={linkClass} href={link.href}>
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <p className="mt-10 border-t border-border pt-6 text-xs text-muted-foreground">
          © {new Date().getFullYear()} receiptOCR
        </p>
      </div>
    </footer>
  );
}
