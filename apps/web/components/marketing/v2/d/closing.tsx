import { cn } from "@receipt-ocr/ui/lib/utils";
import Link from "next/link";
import { faqs } from "@/components/marketing/content";
import { Ctas, SectionHead, Wordmark, focusRing } from "./primitives";

export function FaqD() {
  return (
    <section aria-labelledby="faq" className="scroll-mt-20">
      <div className="mx-auto grid max-w-6xl gap-x-14 gap-y-10 px-4 py-20 sm:px-6 lg:grid-cols-[0.8fr_1.2fr] lg:py-28">
        <SectionHead
          className="lg:sticky lg:top-28 lg:self-start"
          eyebrow="FAQ"
          id="faq"
          lead="The things people ask before handing over a shoebox."
          title="Fair questions."
        />
        <div className="border-b border-[var(--input)]/60">
          {faqs.map((faq) => (
            <details className="group border-t border-[var(--input)]/60" key={faq.q}>
              <summary
                className={cn(
                  "flex min-h-16 cursor-pointer items-center justify-between gap-6 rounded-sm py-4 text-left",
                  focusRing,
                )}
              >
                <h3 className="d-display text-xl font-medium">{faq.q}</h3>
                <span aria-hidden className="relative size-5 shrink-0">
                  <span className="absolute top-1/2 left-0 h-[1.5px] w-full -translate-y-1/2 bg-foreground" />
                  <span className="d-faq-v absolute top-0 left-1/2 h-full w-[1.5px] -translate-x-1/2 bg-foreground transition-transform duration-200 motion-reduce:transition-none" />
                </span>
              </summary>
              <p className="max-w-xl pb-6 leading-relaxed text-muted-foreground">{faq.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

export function FinalCtaD() {
  return (
    <section aria-labelledby="d-final" className="px-4 pb-20 sm:px-6 lg:pb-28">
      <div className="d-lift mx-auto max-w-4xl">
        <div className="d-torn-top bg-card px-6 pb-14 text-center sm:px-12">
          <p className="d-mono mt-6 text-xs tracking-[0.2em] text-muted-foreground uppercase">
            * * * End of receipt * * *
          </p>
          <h2
            className="d-display mt-6 text-[2.6rem] leading-[1.02] font-medium text-balance sm:text-6xl"
            id="d-final"
          >
            Your shoebox can <span className="d-wonk">retire.</span>
          </h2>
          <p className="mx-auto mt-5 max-w-md text-lg leading-relaxed text-muted-foreground">
            Start with this month&apos;s receipts. It&apos;s free, and everything you put in can
            come back out as a CSV.
          </p>
          <Ctas className="mt-9 justify-center" />
        </div>
      </div>
    </section>
  );
}

const footerLinks = [
  { label: "Create a free account", href: "/sign-up" },
  { label: "Sign in", href: "/sign-in" },
  { label: "Privacy", href: "/privacy" },
  { label: "Terms", href: "/terms" },
];

export function FooterD() {
  return (
    <footer className="border-t border-border">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-10 sm:px-6 md:flex-row md:items-center md:justify-between">
        <div>
          <Link
            aria-label="receiptOCR home"
            className={cn("inline-flex min-h-11 items-center rounded-md", focusRing)}
            href="/"
          >
            <Wordmark />
          </Link>
          <p className="mt-1 text-sm text-muted-foreground">
            Receipts in, spreadsheet out. You check every number.
          </p>
        </div>
        <nav aria-label="Footer">
          <ul className="-mx-1 flex flex-wrap gap-x-4">
            {footerLinks.map((link) => (
              <li key={link.href}>
                <Link
                  className={cn(
                    "inline-flex min-h-11 items-center rounded-md px-1 text-sm text-muted-foreground transition-colors hover:text-foreground",
                    focusRing,
                  )}
                  href={link.href}
                >
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </footer>
  );
}
