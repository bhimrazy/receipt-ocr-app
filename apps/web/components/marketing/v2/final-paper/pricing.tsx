import { buttonVariants } from "@receipt-ocr/ui/components/button";
import { cn } from "@receipt-ocr/ui/lib/utils";
import Link from "next/link";
import { ContactButton } from "@/components/contact-button";
import { freePlan } from "@/components/marketing/content";
import { PLANS } from "@/lib/plans";
import { SectionHead } from "./primitives";

const free = PLANS.free;

/** The free plan, itemised like a fee schedule (after v2/g). Numbers come from lib/plans.ts. */
const schedule = [
  { what: "Receipts", condition: "Rolling 24 hours", value: `${free.receiptsPerDay} a day` },
  { what: "Burst", condition: "Per rolling minute", value: `${free.receiptsPerMinute} a minute` },
  { what: "Workspaces", condition: "With teammates you invite", value: String(free.workspaces) },
  { what: "Files", condition: "PNG, JPG or HEIC, 20 per batch", value: "10 MB each" },
  {
    what: "Extraction",
    condition: "Merchant, date, items, tax, total, category",
    value: "Included",
  },
  { what: "Confidence scores", condition: "Per receipt and per line item", value: "Included" },
  {
    what: "Corrections",
    condition: "Merchant, date, category, currency and amounts",
    value: "Included",
  },
  { what: "CSV and JSON export", condition: "One receipt or the whole workspace", value: "$0" },
  { what: "Card on file", condition: "Not asked for", value: "None" },
];

export function PricingPaper() {
  return (
    <section aria-labelledby="pricing" className="scroll-mt-20 bg-secondary/60">
      <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 lg:py-28">
        <SectionHead
          eyebrow="Pricing"
          id="pricing"
          lead="No trial clock and no card on file. Here are the limits, exactly as the code enforces them."
          title={
            <>
              One plan. It costs <span className="pp-wonk">nothing.</span>
            </>
          }
        />

        <div className="mt-14 grid items-start gap-12 lg:grid-cols-[0.8fr_1.2fr] lg:gap-14">
          {/* A paper price tag: notched end, punched hole. Not rotated, so the print stays sharp. */}
          <div className="pp-lift">
            <div className="relative bg-card py-8 pr-6 pl-14 [clip-path:polygon(2.25rem_0,100%_0,100%_100%,2.25rem_100%,0_50%)] sm:py-10 sm:pr-10 sm:pl-20">
              <span
                aria-hidden
                className="pp-tag-hole absolute top-1/2 left-5 size-4 -translate-y-1/2 rounded-full sm:left-7"
              />
              <h3 className="pp-mono text-xs font-medium tracking-[0.16em] text-muted-foreground uppercase">
                {freePlan.name}
              </h3>
              <p className="pp-display mt-2 text-8xl leading-none">{freePlan.price}</p>
              <p className="mt-4 text-muted-foreground">
                No time limit. Start with this month&apos;s receipts and keep going.
              </p>
              <Link
                className={cn(
                  buttonVariants({ size: "lg" }),
                  "mt-8 h-12 w-full px-6 text-[0.95rem] shadow-none hover:shadow-none",
                )}
                href="/sign-up"
              >
                Create a free account
              </Link>
            </div>
          </div>

          <div className="min-w-0">
            <table className="w-full text-[0.95rem]">
              <caption className="sr-only">Free plan limits</caption>
              <thead>
                <tr className="pp-mono border-b border-foreground text-left text-[0.75rem] tracking-[0.12em] text-muted-foreground uppercase">
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
                  <tr className="border-b border-[var(--input)]/40" key={row.what}>
                    <th className="py-3.5 pr-4 text-left font-medium" scope="row">
                      {row.what}
                      <span className="mt-0.5 block text-sm font-normal text-muted-foreground sm:hidden">
                        {row.condition}
                      </span>
                    </th>
                    <td className="hidden py-3.5 pr-4 text-muted-foreground sm:table-cell">
                      {row.condition}
                    </td>
                    <td
                      className={cn(
                        "py-3.5 text-right whitespace-nowrap",
                        /\d/.test(row.value) && "pp-mono",
                      )}
                    >
                      {row.value}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="mt-8 flex flex-col gap-4 rounded-lg border border-dashed border-[var(--input)] p-5 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="flex items-center gap-2 font-medium">
                  Paid plans
                  <span className="pp-mono rounded-full border border-[var(--input)] px-2 py-px text-[0.75rem] font-normal text-muted-foreground">
                    Coming
                  </span>
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Higher daily limits and more workspaces. Need them now? Tell us what you need.
                </p>
              </div>
              <ContactButton
                className="h-11 shrink-0 border-[var(--input)] px-5"
                topic="use-case"
                variant="outline"
              >
                Contact us
              </ContactButton>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
