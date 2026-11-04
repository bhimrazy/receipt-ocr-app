import { Accordion, AccordionItem } from "@receipt-ocr/ui/components/accordion";
import { cn } from "@receipt-ocr/ui/lib/utils";
import Link from "next/link";
import { ContactButton } from "@/components/contact-button";
import { comingSoon } from "../../content";
import { ctaClass, ghostClass } from "./chrome";
import { faqs, plan } from "./data";
import { ComingTag, SectionHead, container } from "./parts";

/** Itemised like a fee schedule: what it is, the condition, the number. */
const schedule = [
  {
    item: "Receipts",
    note: "Resets daily at 00:00 UTC, subject to a service-wide daily cap",
    value: `Up to ${plan.receiptsPerDay} / day`,
  },
  { item: "Burst", note: "Per rolling minute", value: "10 / min" },
  { item: "Upload", note: "Files per upload, read one after another", value: "20" },
  { item: "Image size", note: "PNG, JPG or HEIC", value: "10 MB" },
  { item: "Workspaces", note: "With the people you invite", value: String(plan.workspaces) },
  { item: "Extraction", note: "Merchant, date, items, tax, total, category", value: "Included" },
  { item: "Confidence scores", note: "Per receipt and per line item", value: "Included" },
  { item: "CSV and JSON export", note: "One receipt or the whole workspace", value: "$0" },
  { item: "Card on file", note: "Not asked for", value: "None" },
];

const paid = comingSoon.find((item) => item.title === "Paid plans");

export function Pricing() {
  return (
    <section
      aria-labelledby="fl-pricing"
      className="scroll-mt-20 border-y border-border bg-card"
      id="pricing"
    >
      <div className={cn(container, "py-16 lg:py-24")}>
        <SectionHead
          id="fl-pricing"
          index="04"
          label="Pricing"
          lede="One plan exists today, and it's free. Here are its limits, written down, so nothing surprises you at month end."
          title="Free to start. The limits, in writing."
        />

        <div className="mt-12 grid gap-x-6 gap-y-10 lg:grid-cols-12">
          <div className="lg:col-span-3">
            <p className="text-sm text-muted-foreground">{plan.name}</p>
            <p className="mt-2 flex items-baseline gap-2">
              <span className="fl-num text-[76px] font-semibold leading-none tracking-[-0.05em]">
                {plan.price}
              </span>
              <span className="text-sm text-muted-foreground">No time limit</span>
            </p>
            <p className="mt-4 max-w-[30ch] text-[15px] leading-6 text-(--fl-ink-2)">
              No card needed. Start with this month&apos;s receipts and see if it saves you the
              evening.
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
                    <td className="hidden py-3.5 pr-4 text-(--fl-ink-2) sm:table-cell">
                      {row.note}
                    </td>
                    <td
                      className={cn(
                        "py-3.5 text-right whitespace-nowrap",
                        /\d/.test(row.value) ? "fl-mono" : "text-(--fl-ink-2)",
                      )}
                    >
                      {row.value}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {paid ? (
              <div className="mt-8 flex flex-col gap-4 rounded-xl border border-dashed border-(--fl-rule-strong) p-5 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="flex items-center gap-2 font-medium">
                    {paid.title}
                    <ComingTag />
                  </p>
                  <p className="mt-1 text-sm text-(--fl-ink-2)">{paid.desc}</p>
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
      aria-labelledby="fl-faq"
      className={cn(container, "scroll-mt-20 py-16 lg:py-24")}
      id="faq"
    >
      <SectionHead id="fl-faq" index="05" label="Questions" title="Straight answers." />
      <div className="mt-10 lg:ml-[calc((100%+24px)/4)]">
        <Accordion className="rounded-none border-x-0 border-t-0">
          {faqs.map((faq) => (
            <AccordionItem
              className="px-0 [&_[data-slot=accordion-trigger]]:text-base"
              key={faq.q}
              question={faq.q}
            >
              <p className="max-w-[64ch] text-[15px] text-(--fl-ink-2)">{faq.a}</p>
            </AccordionItem>
          ))}
        </Accordion>
      </div>
    </section>
  );
}

export function FinalCta() {
  return (
    <section aria-labelledby="fl-cta" className="relative">
      {/* Back on the ledger columns the hero opened with. */}
      <div aria-hidden="true" className={cn(container, "pointer-events-none absolute inset-0")}>
        <div className="fl-ledger h-full w-full" />
      </div>
      <div className={cn(container, "relative pt-16 pb-16 lg:pt-24 lg:pb-24")}>
        <div className="grid gap-x-6 gap-y-6 border-t border-foreground pt-5 lg:grid-cols-12">
          <p className="flex gap-3 text-sm text-muted-foreground lg:col-span-3">
            <span className="fl-mono text-foreground">06</span>
            Start
          </p>
          <div className="lg:col-span-9">
            <h2
              className="max-w-[16ch] text-[40px] font-semibold leading-[1.0] tracking-[-0.04em] text-balance sm:text-[64px]"
              id="fl-cta"
            >
              Every receipt, ready for your books.
            </h2>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
              <Link className={ctaClass} href="/sign-up">
                Start free
              </Link>
              <Link className={ghostClass} href="/sign-in">
                Sign in
              </Link>
              <p className="text-sm text-(--fl-ink-2) sm:ml-3">Free to start · no card</p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
