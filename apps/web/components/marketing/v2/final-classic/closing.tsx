import { Accordion, AccordionItem } from "@receipt-ocr/ui/components/accordion";
import { cn } from "@receipt-ocr/ui/lib/utils";
import Link from "next/link";
import { Brand } from "@/components/brand";
import { ContactButton } from "@/components/contact-button";
import { faqs as sharedFaqs } from "@/components/marketing/content";
import { PLANS } from "@/lib/plans";
import { Ctas, Label, Section, SectionHead, focusRing } from "./primitives";

// Three shared answers are stated more exactly here: what can be edited, when the daily count
// resets, and who can access an account.
const answers: Record<string, string> = {
  "How accurate is it?":
    "Each receipt gets an overall confidence score, and each line item gets its own. Low scores show you what to check against the photo. You can fix the merchant, date, category, currency and totals before you export. Line items are read and scored, but you can't edit them yet.",
  "What are the limits on the free plan?": `Up to ${PLANS.free.receiptsPerDay} receipts a day, counted from 00:00 UTC, and ${PLANS.free.workspaces} workspace. On busy days a service-wide daily cap can apply first. Need more? Use Contact us and tell us what you need.`,
  "Who can see my receipts?":
    "Only you and the people you invite to your workspace. receiptOCR admins can access a workspace to handle a support request. Google's Gemini AI reads the images to extract the data. Deleting a receipt, or your account, also deletes the stored images.",
};
const faqs = sharedFaqs.map((faq) => ({ ...faq, a: answers[faq.q] ?? faq.a }));

export function Faq() {
  return (
    <Section id="faq">
      <div className="grid gap-x-14 gap-y-10 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
        <SectionHead
          className="lg:sticky lg:top-28 lg:self-start"
          id="faq"
          label="FAQ"
          lead={
            <>
              What people usually ask before they upload a first receipt. Something else?{" "}
              <ContactButton
                className="h-auto px-0 align-baseline text-lg text-foreground underline decoration-input underline-offset-4 hover:bg-transparent hover:decoration-primary"
                topic="getting-started"
                variant="ghost"
              >
                Ask us
              </ContactButton>
              .
            </>
          }
          title="Questions and answers"
        />
        <Accordion className="bg-card">
          {faqs.map((faq) => (
            <AccordionItem
              className="[&_[data-slot=accordion-trigger]]:text-base"
              key={faq.q}
              question={faq.q}
            >
              {faq.a}
            </AccordionItem>
          ))}
        </Accordion>
      </div>
    </Section>
  );
}

export function FinalCta() {
  return (
    <section aria-labelledby="fc-final" className="px-4 pb-20 sm:px-6 lg:pb-28">
      <div className="relative isolate mx-auto max-w-5xl overflow-hidden rounded-3xl border border-primary/25 bg-primary/[0.05] px-6 py-16 text-center sm:py-20">
        <div aria-hidden className="fc-grid pointer-events-none absolute inset-0 -z-10" />
        <div
          aria-hidden
          className="fc-glow pointer-events-none absolute top-full left-1/2 -z-10 size-[36rem] -translate-x-1/2 -translate-y-1/2"
        />
        <Label>Free plan · no card needed</Label>
        <h2
          className="fc-display mx-auto mt-4 max-w-2xl text-[2.1rem] leading-[1.08] font-bold text-balance sm:text-5xl"
          id="fc-final"
        >
          Try it with your next receipt.
        </h2>
        <p className="mx-auto mt-4 max-w-md text-lg text-pretty text-muted-foreground">
          Everything you put in can come back out as a CSV.
        </p>
        <Ctas
          className="mx-auto mt-9 max-w-sm justify-center sm:max-w-none"
          secondaryHref="/sign-in"
          secondaryLabel="Sign in"
        />
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

export function Footer() {
  return (
    <footer className="border-t border-border">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-10 sm:px-6 md:flex-row md:items-center md:justify-between">
        <div>
          <Link
            aria-label="receiptOCR home"
            className={cn("inline-flex min-h-11 items-center rounded-md", focusRing)}
            href="/"
          >
            <Brand />
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
