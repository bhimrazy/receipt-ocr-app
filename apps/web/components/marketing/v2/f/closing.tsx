import { cn } from "@receipt-ocr/ui/lib/utils";
import { Check, Plus } from "lucide-react";
import Link from "next/link";
import { ContactButton } from "@/components/contact-button";
import { comingSoon, faqs, freePlan } from "../../content";
import { FBrand, ring, StartFree } from "./bits";
import { nav } from "./copy";

const contactClass = cn(
  "f-btn h-12 rounded-full border-2 border-[var(--f-ink)] bg-[var(--f-paper)] px-5 text-base font-bold text-[var(--f-ink)] hover:bg-[var(--f-yellow)] max-md:h-12",
  ring,
);

export function FPricing() {
  return (
    <section
      aria-labelledby="f-pricing-title"
      className="scroll-mt-4 px-4 py-24 sm:px-6 md:py-32"
      id="pricing"
    >
      <div className="mx-auto max-w-6xl">
        <p className="font-mono text-sm font-bold uppercase tracking-[0.18em] text-muted-foreground">
          Pricing
        </p>
        <h2 className="f-display mt-4 text-[clamp(3rem,9vw,6rem)]" id="f-pricing-title">
          One plan.
          <br />
          It&apos;s free.
        </h2>

        <div className="mt-14 grid gap-8 lg:grid-cols-[1.25fr_1fr] lg:gap-10">
          {/* Price tag */}
          <div className="f-pop-lg relative rounded-[2.25rem] border-2 border-foreground bg-[var(--f-orange)] p-6 text-[var(--f-ink)] sm:p-10">
            <span
              aria-hidden
              className="absolute right-7 top-7 size-6 rounded-full border-2 border-[var(--f-ink)] bg-background sm:right-10 sm:top-10"
            />
            <h3 className="text-xl font-extrabold">{freePlan.name}</h3>
            <p className="mt-2 flex items-end gap-3">
              <span className="f-display text-[clamp(6rem,22vw,9rem)]">{freePlan.price}</span>
              <span className="pb-3 text-lg font-bold leading-tight">
                No card.
                <br />
                No time limit.
              </span>
            </p>
            <ul className="mt-6 grid gap-3 sm:grid-cols-2">
              {freePlan.includes.map((item) => (
                <li className="flex gap-2.5 text-base font-semibold leading-snug" key={item}>
                  <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-[var(--f-ink)] text-[var(--f-cream)]">
                    <Check aria-hidden className="size-3" strokeWidth={3.5} />
                  </span>
                  {item}
                </li>
              ))}
            </ul>
            <div className="f-on-orange mt-9">
              <StartFree className="w-full sm:w-auto" label="Start free" />
            </div>
          </div>

          {/* Coming later */}
          <div className="flex flex-col rounded-[2.25rem] border-2 border-dashed border-foreground p-6 sm:p-10">
            <h3 className="text-xl font-extrabold">Coming later</h3>
            <p className="mt-2 text-base text-muted-foreground">
              Not built yet, so we&apos;re not charging for it.
            </p>
            <ul className="mt-6 flex flex-col gap-5">
              {comingSoon.map((item) => (
                <li key={item.title}>
                  <p className="flex items-center gap-2.5 text-lg font-extrabold">
                    {item.title}
                    <span className="rounded-full border-2 border-foreground px-2 py-0.5 font-mono text-[11px] font-bold uppercase tracking-wider">
                      Coming
                    </span>
                  </p>
                  <p className="mt-1 text-base leading-relaxed text-muted-foreground">
                    {item.desc}
                  </p>
                </li>
              ))}
            </ul>
            <div className="mt-auto pt-8">
              <ContactButton className={contactClass} topic="use-case" variant="outline">
                Need more than {freePlan.receiptsPerDay} a day? Tell us
              </ContactButton>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

export function FFaq() {
  return (
    <section
      aria-labelledby="f-faq-title"
      className="scroll-mt-4 border-t-2 border-foreground px-4 py-24 sm:px-6 md:py-32"
      id="faq"
    >
      <div className="mx-auto grid max-w-6xl gap-12 lg:grid-cols-[1fr_1.5fr]">
        <div>
          <p className="font-mono text-sm font-bold uppercase tracking-[0.18em] text-muted-foreground">
            FAQ
          </p>
          <h2 className="f-display mt-4 text-[clamp(3rem,9vw,6rem)]" id="f-faq-title">
            Fair
            <br />
            questions.
          </h2>
          <p className="mt-6 max-w-xs text-lg text-muted-foreground">
            Something else on your mind? A real person reads every message.
          </p>
          <ContactButton
            className={cn(contactClass, "mt-6")}
            topic="getting-started"
            variant="outline"
          >
            Ask us anything
          </ContactButton>
        </div>
        <div className="flex flex-col gap-4">
          {faqs.map((faq) => (
            <details
              className="group f-pop rounded-3xl border-2 border-foreground bg-[var(--f-paper)] open:bg-[var(--f-yellow)] [&_summary::-webkit-details-marker]:hidden"
              key={faq.q}
            >
              <summary
                className={cn(
                  "flex min-h-16 cursor-pointer list-none items-center justify-between gap-4 rounded-3xl px-5 py-4 text-left text-lg font-extrabold sm:px-6",
                  ring,
                )}
              >
                {faq.q}
                <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[var(--f-ink)] text-[var(--f-cream)] transition-transform duration-200 group-open:rotate-45 motion-reduce:transition-none">
                  <Plus aria-hidden className="size-5" strokeWidth={3} />
                </span>
              </summary>
              <p className="max-w-2xl px-5 pb-6 text-base leading-relaxed sm:px-6">{faq.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

export function FFinalCta() {
  return (
    <section
      aria-labelledby="f-cta-title"
      className="f-on-orange bg-background px-4 py-24 text-foreground sm:px-6 md:py-32"
    >
      <div className="mx-auto flex max-w-6xl flex-col items-start gap-8 md:flex-row md:items-end md:justify-between">
        <h2 className="f-display text-[clamp(4rem,15vw,9.5rem)]" id="f-cta-title">
          Empty the
          <br />
          shoebox.
        </h2>
        <div className="flex w-full flex-col gap-4 md:w-auto md:items-end md:pb-3">
          <p className="max-w-xs text-lg font-semibold md:text-right">
            Your first {freePlan.receiptsPerDay} receipts are on us. Every single day.
          </p>
          <StartFree className="w-full md:w-auto" />
        </div>
      </div>
    </section>
  );
}

const footerLinks = [
  ...nav,
  { href: "/sign-up", label: "Create an account" },
  { href: "/sign-in", label: "Sign in" },
  { href: "/privacy", label: "Privacy" },
  { href: "/terms", label: "Terms" },
];

export function FFooter() {
  return (
    <footer className="f-on-ink bg-background px-4 pb-10 pt-16 text-foreground sm:px-6">
      <div className="mx-auto max-w-6xl">
        <div className="flex flex-col gap-10 md:flex-row md:items-start md:justify-between">
          <div className="max-w-xs">
            <FBrand />
            <p className="mt-4 text-base text-muted-foreground">
              Receipts in, spreadsheet out. Check every number before it reaches your books.
            </p>
          </div>
          <nav aria-label="Footer">
            <ul className="grid grid-cols-2 gap-x-10 sm:grid-cols-3">
              {footerLinks.map((link) => (
                <li key={link.href}>
                  <Link
                    className={cn(
                      "inline-flex min-h-11 min-w-11 items-center rounded-md font-semibold text-muted-foreground hover:text-foreground",
                      ring,
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
        <p className="mt-12 border-t border-border pt-6 text-sm text-muted-foreground">
          © {new Date().getFullYear()} ReceiptOCR
        </p>
      </div>
    </footer>
  );
}
