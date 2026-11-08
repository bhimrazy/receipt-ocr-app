import { buttonVariants } from "@receipt-ocr/ui/components/button";
import { cn } from "@receipt-ocr/ui/lib/utils";
import { Download, KeyRound, PencilLine, ScanLine } from "lucide-react";
import Link from "next/link";
import { Brand } from "@/components/brand";
import { CookieSettingsButton } from "@/components/consent/cookie-settings-button";
import { supportEmail } from "@/lib/env";
import { getPlanTable } from "@/lib/plan-limits";
import { AuthMessage } from "./auth-field";
import { allowance } from "@/lib/plan-copy";

const valueProps = (freeAllowance: string) => [
  {
    icon: ScanLine,
    title: "Scans the whole receipt",
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
    desc: `Free plan: ${freeAllowance}, no card required.`,
  },
];

const footerLink =
  "inline-flex min-h-11 min-w-11 items-center justify-center rounded-sm hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/** Shows the free plan's saved daily limit; pages using it revalidate hourly or on save. */
export async function AuthLayout({
  children,
  subtitle,
}: {
  children: React.ReactNode;
  subtitle: string;
}) {
  const plans = await getPlanTable();
  return (
    <div className="relative grid min-h-dvh overflow-x-clip bg-background lg:grid-cols-2">
      <aside className="relative hidden flex-col justify-between gap-8 border-r border-border bg-secondary/20 p-10 lg:flex xl:p-12">
        <div aria-hidden className="grid-mask pointer-events-none absolute inset-0 opacity-30">
          <div className="receipt-grid absolute -inset-1" />
        </div>
        <div
          aria-hidden
          className="hero-aurora pointer-events-none absolute left-1/3 top-1/2 size-[560px] -translate-x-1/2 -translate-y-1/2 rounded-full opacity-60"
        />
        <Link
          aria-label="ReceiptOCR home"
          className="relative z-10 inline-flex min-h-11 w-fit items-center rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          href="/"
        >
          <Brand />
        </Link>
        <div className="relative z-10 max-w-md">
          {/* The form card holds the page's h1, so this stays a paragraph. */}
          <p className="text-balance text-4xl font-bold leading-tight tracking-tight">
            Turn receipt photos into <span className="text-gradient">spreadsheet rows</span>
          </p>
          <p className="mt-4 text-pretty leading-7 text-muted-foreground">{subtitle}</p>
          <ul className="mt-8 flex flex-col gap-5">
            {valueProps(allowance(plans.free)).map(({ icon: Icon, title, desc }) => (
              <li className="flex items-start gap-4" key={title}>
                <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary ring-1 ring-inset ring-primary/20">
                  <Icon aria-hidden className="size-5" />
                </span>
                <div>
                  <p className="font-medium">{title}</p>
                  <p className="mt-0.5 text-sm leading-6 text-muted-foreground">{desc}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
        <p className="relative z-10 text-xs text-muted-foreground">
          © {new Date().getFullYear()} ReceiptOCR
        </p>
      </aside>

      <div className="relative flex min-w-0 flex-col">
        <div
          aria-hidden
          className="absolute left-1/2 top-[35%] size-[520px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary/10 blur-[170px] lg:hidden"
        />
        {/* Top-anchored, not centred: a centred card moves up by half of whatever it grows by (an
            error, a challenge). The offset puts the sign-in card near the middle and leaves room
            for an error before the page scrolls; phones add the logo above it. */}
        <main className="relative z-10 flex flex-1 flex-col items-center px-4 pb-4 pt-[max(1rem,calc(50dvh-24rem))] sm:px-5 lg:pt-[max(1rem,calc(50dvh-21rem))]">
          <div className="flex w-full max-w-md flex-col items-center">
            <Link
              aria-label="ReceiptOCR home"
              className="mb-6 inline-flex min-h-11 items-center rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:hidden"
              href="/"
            >
              <Brand />
            </Link>
            {children}
          </div>
        </main>
        <footer className="relative z-10 flex justify-center px-4 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
          <nav aria-label="Legal" className="flex gap-6 text-sm text-muted-foreground">
            <Link className={footerLink} href="/">
              Home
            </Link>
            <Link className={footerLink} href="/privacy">
              Privacy
            </Link>
            <Link className={footerLink} href="/terms">
              Terms
            </Link>
            <CookieSettingsButton
              className={cn(footerLink, "h-auto px-0 font-normal hover:bg-transparent")}
            />
          </nav>
        </footer>
      </div>
    </div>
  );
}

/** Generic on purpose: what is missing is logged at boot (`auth.not_configured`), not shown. */
export function AuthNotConfiguredCard() {
  return (
    <AuthMessage
      actions={
        <>
          {supportEmail ? (
            <a
              className={cn(buttonVariants({ variant: "outline" }), "h-11 w-full")}
              href={`mailto:${supportEmail}`}
            >
              Contact support
            </a>
          ) : null}
          <Link className={cn(buttonVariants({ variant: "outline" }), "h-11 w-full")} href="/">
            Go to the home page
          </Link>
        </>
      }
      icon={KeyRound}
      title="Sign-in isn't set up yet"
      tone="warning"
    >
      <p>Please contact the administrator.</p>
    </AuthMessage>
  );
}
