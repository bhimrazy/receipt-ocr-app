import { Accordion, AccordionItem } from "@receipt-ocr/ui/components/accordion";
import { cn } from "@receipt-ocr/ui/lib/utils";
import Link from "next/link";
import { ContactButton } from "@/components/contact-button";
import { comingSoon, faqs } from "../../content";
import { ctaClass, ghostClass } from "./chrome";
import { plan } from "./data";
import { SectionHead, container } from "./parts";

/** Itemised like a fee schedule: what it is, the condition, the number. */
const schedule = [
  { item: "Receipts", note: "Rolling 24 hours", value: `${plan.receiptsPerDay} / day` },
  { item: "Burst", note: "Per rolling minute", value: "10 / min" },
  { item: "Workspaces", note: "With teammates you invite", value: String(plan.workspaces) },
  { item: "Extraction", note: "Merchant, date, items, tax, total, category", value: "Included" },
  { item: "Confidence scores", note: "Per receipt and per line item", value: "Included" },
  { item: "Corrections", note: "Merchant, date, category and amounts", value: "Included" },
  { item: "CSV and JSON export", note: "One receipt or the whole workspace", value: "$0" },
  { item: "Card on file", note: "Not asked for", value: "None" },
];

const paid = comingSoon.find((item) => item.title === "Paid plans");

export function Pricing() {
  return (
    <section
      aria-labelledby="g-pricing"
      className="scroll-mt-20 border-y border-border bg-card"
      id="pricing"
    >
      <div className={cn(container, "py-16 lg:py-24")}>
        <SectionHead
          id="g-pricing"
          index="04"
          label="Pricing"
          lede="One plan exists today, and it's free. These are its limits, as the code enforces them."
          title="Free, with the limits written down."
        />

        <div className="mt-14 grid gap-x-6 gap-y-10 lg:grid-cols-12">
          <div className="lg:col-span-3">
            <p className="text-sm text-muted-foreground">{plan.name}</p>
            <p className="mt-2 flex items-baseline gap-2">
              <span className="g-num text-[72px] font-semibold leading-none tracking-[-0.04em]">
                {plan.price}
              </span>
              <span className="text-sm text-muted-foreground">No time limit</span>
            </p>
            <p className="mt-4 max-w-[34ch] text-[15px] leading-6 text-(--g-ink-2)">
              {plan.summary}
            </p>
            <Link className={cn(ctaClass, "mt-8 w-full sm:w-auto")} href="/sign-up">
              Start free
            </Link>
          </div>

          <div className="min-w-0 lg:col-span-9">
            <table className="w-full text-[15px]">
              <caption className="sr-only">Free plan, itemised</caption>
              <thead>
                <tr className="border-b border-foreground text-left text-xs text-muted-foreground">
                  <th className="pb-3 font-medium" scope="col">
                    What
                  </th>
                  <th className="hidden pb-3 font-medium sm:table-cell" scope="col">
                    Condition
                  </th>
                  <th className="pb-3 text-right font-medium" scope="col">
                    Free plan
                  </th>
                </tr>
              </thead>
              <tbody>
                {schedule.map((row) => (
                  <tr className="border-b border-border" key={row.item}>
                    <th className="py-3.5 pr-4 text-left font-medium" scope="row">
                      {row.item}
                      <span className="mt-0.5 block text-sm font-normal text-muted-foreground sm:hidden">
                        {row.note}
                      </span>
                    </th>
                    <td className="hidden py-3.5 pr-4 text-(--g-ink-2) sm:table-cell">
                      {row.note}
                    </td>
                    <td
                      className={cn(
                        "whitespace-nowrap py-3.5 text-right",
                        /\d/.test(row.value) ? "g-mono" : "text-(--g-ink-2)",
                      )}
                    >
                      {row.value}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {paid ? (
              <div className="mt-8 flex flex-col gap-4 rounded-xl border border-dashed border-(--g-rule-strong) p-5 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="flex items-center gap-2 font-medium">
                    {paid.title}
                    <span className="rounded-[4px] border border-border px-1 py-px text-[11px] font-medium text-muted-foreground">
                      Coming
                    </span>
                  </p>
                  <p className="mt-1 text-sm text-(--g-ink-2)">{paid.desc}</p>
                </div>
                <ContactButton
                  className={cn(ghostClass, "shrink-0")}
                  topic="use-case"
                  variant="outline"
                >
                  Contact us
                </ContactButton>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}

export function Faq() {
  return (
    <section
      aria-labelledby="g-faq"
      className={cn(container, "scroll-mt-20 py-16 lg:py-24")}
      id="faq"
    >
      <SectionHead id="g-faq" index="05" label="Questions" title="Straight answers." />
      <div className="mt-10 lg:ml-[calc((100%+24px)/4)]">
        <Accordion className="rounded-none border-x-0 border-t-0">
          {faqs.map((faq) => (
            <AccordionItem
              className="px-0 [&_[data-slot=accordion-trigger]]:text-base"
              key={faq.q}
              question={faq.q}
            >
              <p className="max-w-[64ch] text-[15px] text-(--g-ink-2)">{faq.a}</p>
            </AccordionItem>
          ))}
        </Accordion>
      </div>
    </section>
  );
}

export function FinalCta() {
  return (
    <section aria-labelledby="g-cta" className="bg-foreground text-background">
      <div className={cn(container, "grid gap-8 py-20 lg:grid-cols-12 lg:items-end lg:py-24")}>
        <div className="lg:col-span-8">
          <h2
            className="max-w-[18ch] text-[36px] font-semibold leading-[1.05] tracking-[-0.03em] text-balance sm:text-[52px]"
            id="g-cta"
          >
            Start with this month&apos;s receipts.
          </h2>
          <p className="mt-5 text-[17px] text-[color-mix(in_oklab,var(--background)_78%,var(--foreground))]">
            {plan.price} · {plan.receiptsPerDay} receipts a day · No card
          </p>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row lg:col-span-4 lg:justify-end">
          <Link
            className={cn(
              ctaClass,
              "bg-background text-foreground hover:bg-card focus-visible:ring-background focus-visible:ring-offset-foreground",
            )}
            href="/sign-up"
          >
            Start free
          </Link>
          <Link
            className="inline-flex h-12 items-center justify-center rounded-lg border border-[color-mix(in_oklab,var(--background)_35%,transparent)] px-5 text-sm font-medium outline-none hover:bg-[color-mix(in_oklab,var(--background)_10%,transparent)] focus-visible:ring-2 focus-visible:ring-background"
            href="/sign-in"
          >
            Sign in
          </Link>
        </div>
      </div>
    </section>
  );
}
