import { ScanLine, ShieldCheck, Sparkles } from "lucide-react";
import Link from "next/link";
import { Brand } from "@/components/brand";

export const valueProps = [
  {
    icon: ScanLine,
    title: "Extract in seconds",
    desc: "Merchant, line items, tax, and totals — each with a confidence score.",
  },
  {
    icon: Sparkles,
    title: "Free to start",
    desc: "No credit card. Bring your own keys when you outgrow the free tier.",
  },
  {
    icon: ShieldCheck,
    title: "Private by design",
    desc: "Your receipts and storage keys stay server-side, never in the browser.",
  },
];

export function AuthLayout({
  children,
  subtitle,
}: {
  children: React.ReactNode;
  subtitle: string;
}) {
  return (
    <main className="relative grid min-h-screen overflow-hidden bg-background lg:grid-cols-2">
      {/* Left: value panel */}
      <aside className="relative hidden flex-col justify-between border-r border-border bg-secondary/20 p-12 lg:flex">
        <div className="grid-mask pointer-events-none absolute inset-0 opacity-30">
          <div className="receipt-grid absolute -inset-1" />
        </div>
        <div className="hero-aurora pointer-events-none absolute left-1/3 top-1/2 size-[560px] -translate-x-1/2 -translate-y-1/2 rounded-full opacity-60" />
        <Link href="/" aria-label="receiptOCR home" className="relative z-10 w-fit">
          <Brand />
        </Link>
        <div className="relative z-10 max-w-md">
          <h1 className="text-balance text-4xl font-bold leading-tight tracking-tight">
            Turn receipts into <span className="text-gradient">structured data</span>
          </h1>
          <p className="mt-4 text-pretty leading-7 text-muted-foreground">{subtitle}</p>
          <ul className="mt-10 flex flex-col gap-6">
            {valueProps.map((prop) => {
              const Icon = prop.icon;
              return (
                <li className="flex items-start gap-4" key={prop.title}>
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-primary/20 bg-primary/10 text-primary">
                    <Icon className="size-5" />
                  </span>
                  <div>
                    <p className="font-medium">{prop.title}</p>
                    <p className="mt-1 text-sm leading-6 text-muted-foreground">{prop.desc}</p>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
        <p className="relative z-10 font-mono text-xs text-muted-foreground/70">
          Next.js · Better Auth · Effect · AI SDK · Drizzle
        </p>
      </aside>

      {/* Right: form */}
      <section className="relative flex items-center justify-center px-5 py-16">
        <div className="absolute left-1/2 top-[35%] size-[520px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary/10 blur-[170px] lg:hidden" />
        <div className="relative z-10 flex w-full max-w-md flex-col items-center">
          <Link href="/" aria-label="receiptOCR home" className="mb-8 lg:hidden">
            <Brand />
          </Link>
          {children}
          <div className="mt-6 flex gap-5 text-xs text-muted-foreground">
            <Link className="hover:text-foreground" href="/">
              Back to home
            </Link>
            <Link className="hover:text-foreground" href="/privacy">
              Privacy
            </Link>
            <Link className="hover:text-foreground" href="/terms">
              Terms
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}

export function AuthNotConfiguredCard() {
  return (
    <div className="w-full rounded-2xl border border-white/10 bg-card/80 p-8 text-center shadow-2xl backdrop-blur-xl">
      <h2 className="text-2xl font-semibold tracking-tight">Auth is not configured</h2>
      <p className="mt-3 text-sm leading-6 text-muted-foreground">
        Add `DATABASE_URL` and `BETTER_AUTH_SECRET` to `apps/web/.env.local` to enable
        email/password and Google/GitHub sign-in.
      </p>
      <Link
        className="mt-6 inline-flex h-10 items-center justify-center rounded-full bg-primary px-4 text-sm font-medium text-primary-foreground"
        href="/app/upload"
      >
        Preview app UI
      </Link>
    </div>
  );
}
