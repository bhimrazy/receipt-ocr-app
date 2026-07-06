import Link from "next/link";
import { Brand } from "@/components/brand";

const columns: Array<{ title: string; links: Array<{ label: string; href: string }> }> = [
  {
    title: "Product",
    links: [
      { label: "Features", href: "/#features" },
      { label: "How it works", href: "/#how" },
      { label: "Pricing", href: "/#pricing" },
      { label: "FAQ", href: "/#faq" },
    ],
  },
  {
    title: "Get started",
    links: [
      { label: "Create a free account", href: "/sign-in" },
      { label: "Sign in", href: "/sign-in" },
      { label: "Upload a receipt", href: "/app/upload" },
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

export function SiteFooter() {
  return (
    <footer className="border-t border-border px-5 pb-10 pt-16">
      <div className="mx-auto max-w-6xl">
        <div className="grid gap-10 md:grid-cols-[1.5fr_repeat(3,1fr)]">
          <div className="max-w-xs">
            <Brand />
            <p className="mt-4 text-sm leading-6 text-muted-foreground">
              Turn any receipt into clean, structured data — searchable, exportable, and yours.
            </p>
          </div>
          {columns.map((column) => (
            <div key={column.title}>
              <h3 className="font-mono text-xs uppercase tracking-[0.18em] text-muted-foreground">
                {column.title}
              </h3>
              <ul className="mt-4 flex flex-col gap-3 text-sm">
                {column.links.map((link) => (
                  <li key={link.label}>
                    <Link
                      className="text-muted-foreground transition-colors hover:text-foreground"
                      href={link.href}
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="mt-12 flex flex-col items-center justify-between gap-3 border-t border-border pt-6 text-xs text-muted-foreground md:flex-row">
          <span>© {new Date().getFullYear()} receiptOCR. All rights reserved.</span>
          <span className="font-mono">Next.js · Clerk · Effect · AI SDK · Drizzle</span>
        </div>
      </div>
    </footer>
  );
}
