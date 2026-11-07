import { cn } from "@receipt-ocr/ui/lib/utils";
import Link from "next/link";
import { ContactButton } from "@/components/contact-button";
import { faqs as sharedFaqs } from "@/components/marketing/content";
import { PLANS } from "@/lib/plans";
import { Ctas, SectionHead, Wordmark, focusRing } from "./primitives";

// Three shared answers are stated more exactly here: what can be edited, when the daily count
// resets, and who can access an account.
const faqs = sharedFaqs.map((faq) =>
  faq.q === "How accurate is it?"
    ? {
        ...faq,
        a: "Each receipt gets an overall confidence score, and each line item gets its own. Low scores show you what to check against the photo. You can fix the merchant, date, category, currency and totals before you export; line items are read and scored but not editable yet.",
      }
    : faq.q === "What are the limits on the free plan?"
      ? {
          ...faq,
          a: `Up to ${PLANS.free.receiptsPerDay} receipts a day, counted from 00:00 UTC, and ${PLANS.free.workspaces} workspace. A service-wide daily cap can apply first on busy days. Need more? Use Contact us and tell us what you need.`,
        }
      : faq.q === "Who can see my receipts?"
        ? {
            ...faq,
            a: "Only you and the people you invite to your workspace. ReceiptOCR admins can access an account only to handle a support request. Images are scanned by Google's Gemini AI to extract the data. Deleting a receipt, or your account, deletes the stored images too.",
          }
        : faq,
);

export function FaqPaper() {
  return (
    <section aria-labelledby="faq" className="scroll-mt-20">
      <div className="mx-auto grid max-w-6xl gap-x-14 gap-y-10 px-4 py-20 sm:px-6 lg:grid-cols-[0.8fr_1.2fr] lg:py-28">
        <SectionHead
          className="lg:sticky lg:top-28 lg:self-start"
          eyebrow="FAQ"
          id="faq"
          lead="What people usually ask before they upload their first receipt."
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
                <h3 className="pp-display text-xl">{faq.q}</h3>
                <span aria-hidden className="relative size-5 shrink-0">
                  <span className="absolute top-1/2 left-0 h-[1.5px] w-full -translate-y-1/2 bg-foreground" />
                  <span className="pp-faq-v absolute top-0 left-1/2 h-full w-[1.5px] -translate-x-1/2 bg-foreground transition-transform duration-200 motion-reduce:transition-none" />
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

export function FinalCtaPaper() {
  return (
    <section aria-labelledby="pp-final" className="px-4 pb-20 sm:px-6 lg:pb-28">
      <div className="pp-lift mx-auto max-w-4xl">
        <div className="pp-torn-top bg-card px-6 pb-14 text-center sm:px-12">
          <p className="pp-mono mt-6 text-xs tracking-[0.2em] text-muted-foreground uppercase">
            * * * End of receipt * * *
          </p>
          <h2
            className="pp-display mt-6 text-[2.6rem] leading-[1.02] text-balance sm:text-6xl"
            id="pp-final"
          >
            Your receipts, <span className="pp-wonk">done.</span>
          </h2>
          <p className="mx-auto mt-5 max-w-md text-lg leading-relaxed text-muted-foreground">
            Start with this month&apos;s receipts. It&apos;s free, and everything you put in can
            come back out as a CSV.
          </p>
          <Ctas
            className="mt-9 justify-center"
            secondaryHref="/sign-in"
            secondaryLabel="I already have an account"
          />
        </div>
      </div>
    </section>
  );
}

const footerLinks = [
  { label: "Pricing", href: "#pricing" },
  { label: "Your data", href: "#data" },
  { label: "Create a free account", href: "/sign-up" },
  { label: "Sign in", href: "/sign-in" },
  { label: "Privacy", href: "/privacy" },
  { label: "Terms", href: "/terms" },
];

export function FooterPaper() {
  return (
    <footer className="border-t border-border">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-10 sm:px-6 md:flex-row md:items-center md:justify-between">
        <div>
          <Link
            aria-label="ReceiptOCR home"
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
            <li>
              <ContactButton
                className="h-11 px-1 text-sm font-normal text-muted-foreground hover:bg-transparent hover:text-foreground"
                topic="getting-started"
                variant="ghost"
              >
                Contact
              </ContactButton>
            </li>
          </ul>
        </nav>
      </div>
    </footer>
  );
}
