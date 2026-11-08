import { cn } from "@receipt-ocr/ui/lib/utils";
import Link from "next/link";
import { Brand } from "@/components/brand";
import { GitHubIcon } from "@/components/github-icon";
import { authorName, authorUrl, repoUrl } from "@/lib/site";
import { CookieSettingsButton } from "@/components/consent/cookie-settings-button";
import { GetTheAppEntry } from "@/components/landing-install";

const columns: Array<{ title: string; links: Array<{ label: string; href: string }> }> = [
  {
    title: "Product",
    links: [
      { label: "How it works", href: "/#how" },
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
      { label: "Cookies", href: "/cookies" },
    ],
  },
];

const linkClass =
  "inline-flex min-h-11 items-center rounded-md text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:min-h-8";

const authorLinkClass =
  "inline-flex min-h-11 items-center rounded-md underline-offset-4 transition-colors hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-8";

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
                {column.title === "Product" && (
                  <GetTheAppEntry className={cn(linkClass, "cursor-pointer text-left")} />
                )}
                {column.title === "Legal" && (
                  <li>
                    <CookieSettingsButton
                      className={cn(
                        linkClass,
                        "h-auto justify-start px-0 font-normal hover:bg-transparent",
                      )}
                    />
                  </li>
                )}
              </ul>
            </div>
          ))}
        </div>
        <div className="mt-10 flex flex-col gap-x-6 gap-y-1 border-t border-border pt-6 text-xs text-muted-foreground sm:flex-row sm:flex-wrap sm:items-center">
          <p className="sm:mr-auto">© {new Date().getFullYear()} ReceiptOCR</p>
          <p>
            A product by{" "}
            <a className={authorLinkClass} href={authorUrl} rel="noopener" target="_blank">
              {authorName}
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
          </p>
          <a
            className={cn(authorLinkClass, "inline-flex items-center gap-1.5")}
            href={repoUrl}
            rel="noopener"
            target="_blank"
          >
            <GitHubIcon className="size-3.5" />
            Open source on GitHub
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
        </div>
      </div>
    </footer>
  );
}
