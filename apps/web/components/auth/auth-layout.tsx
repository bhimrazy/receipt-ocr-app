import { buttonVariants } from "@receipt-ocr/ui/components/button";
import { cn } from "@receipt-ocr/ui/lib/utils";
import { Download, PencilLine, ScanLine } from "lucide-react";
import Link from "next/link";
import { Brand } from "@/components/brand";
import { PLANS } from "@/lib/plans";
import { authCardClass } from "./auth-field";

export const valueProps = [
  {
    icon: ScanLine,
    title: "Reads the whole receipt",
    desc: "Merchant, date, line items, tax and total, with a confidence score.",
  },
  {
    icon: PencilLine,
    title: "You check it",
    desc: "Fix any field it misread before it goes into your books.",
  },
  {
    icon: Download,
    title: "Export a CSV",
    desc: `Free plan: ${PLANS.free.receiptsPerDay} receipts a day, no card required.`,
  },
];

const footerLink =
  "inline-flex min-h-11 items-center rounded-sm hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function AuthLayout({
  children,
  subtitle,
}: {
  children: React.ReactNode;
  subtitle: string;
}) {
  return (
    <div className="relative grid min-h-screen overflow-hidden bg-background lg:grid-cols-2">
      <aside className="relative hidden flex-col justify-between border-r border-border bg-secondary/20 p-12 lg:flex">
        <div aria-hidden className="grid-mask pointer-events-none absolute inset-0 opacity-30">
          <div className="receipt-grid absolute -inset-1" />
        </div>
        <div className="hero-aurora pointer-events-none absolute left-1/3 top-1/2 size-[560px] -translate-x-1/2 -translate-y-1/2 rounded-full opacity-60" />
        <Link
          aria-label="receiptOCR home"
          className="relative z-10 inline-flex min-h-11 w-fit items-center rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          href="/"
        >
          <Brand />
        </Link>
        <div className="relative z-10 max-w-md">
          {/* The form card holds the page's h1, so this stays a paragraph. */}
          <p className="text-balance text-4xl font-bold leading-tight tracking-tight">
            Snap a receipt. <span className="text-gradient">Get a spreadsheet.</span>
          </p>
          <p className="mt-4 text-pretty leading-7 text-muted-foreground">{subtitle}</p>
          <ul className="mt-10 flex flex-col gap-6">
            {valueProps.map(({ icon: Icon, title, desc }) => (
              <li className="flex items-start gap-4" key={title}>
                <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary ring-1 ring-inset ring-primary/20">
                  <Icon aria-hidden className="size-5" />
                </span>
                <div>
                  <p className="font-medium">{title}</p>
                  <p className="mt-1 text-sm leading-6 text-muted-foreground">{desc}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
        <p className="relative z-10 text-xs text-muted-foreground">
          © {new Date().getFullYear()} receiptOCR
        </p>
      </aside>

      <main className="relative flex items-center justify-center px-4 py-12 sm:px-5 sm:py-16">
        <div className="absolute left-1/2 top-[35%] size-[520px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary/10 blur-[170px] lg:hidden" />
        <div className="relative z-10 flex w-full max-w-md flex-col items-center">
          <Link
            aria-label="receiptOCR home"
            className="mb-8 inline-flex min-h-11 items-center rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:hidden"
            href="/"
          >
            <Brand />
          </Link>
          {children}
          <nav aria-label="Legal" className="mt-4 flex gap-6 text-sm text-muted-foreground">
            <Link className={footerLink} href="/">
              Home
            </Link>
            <Link className={footerLink} href="/privacy">
              Privacy
            </Link>
            <Link className={footerLink} href="/terms">
              Terms
            </Link>
          </nav>
        </div>
      </main>
    </div>
  );
}

/** Only reachable in a local setup without auth env vars, so it can speak to the developer. */
export function AuthNotConfiguredCard() {
  return (
    <div className={cn(authCardClass, "text-center")}>
      <h1 className="text-2xl font-semibold tracking-tight">Sign-in isn&apos;t set up</h1>
      <p className="mt-3 text-sm leading-6 text-muted-foreground">
        Add <code className="font-mono text-foreground">DATABASE_URL</code> and{" "}
        <code className="font-mono text-foreground">BETTER_AUTH_SECRET</code> to{" "}
        <code className="font-mono text-foreground">apps/web/.env.local</code> to turn on email and
        social sign-in.
      </p>
      <Link className={cn(buttonVariants(), "mt-6 h-11")} href="/app">
        Preview the app
      </Link>
    </div>
  );
}
