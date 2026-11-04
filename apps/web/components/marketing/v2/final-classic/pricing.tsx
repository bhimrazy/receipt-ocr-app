import { Badge } from "@receipt-ocr/ui/components/badge";
import { buttonVariants } from "@receipt-ocr/ui/components/button";
import { cn } from "@receipt-ocr/ui/lib/utils";
import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { ContactButton } from "@/components/contact-button";
import { freePlan } from "@/components/marketing/content";
import { PLANS } from "@/lib/plans";
import { Section, SectionHead } from "./primitives";

const free = PLANS.free;

/** The free plan's limits, exactly as lib/plans.ts and packages/core/src/quota.ts enforce them. */
const limits: Array<{ what: string; condition?: string; value: string }> = [
  {
    what: "Receipts",
    condition: "Resets daily at 00:00 UTC, subject to a service-wide daily cap",
    value: `${free.receiptsPerDay} a day`,
  },
  {
    what: "Per minute",
    condition: "In any one minute",
    value: `${free.receiptsPerMinute} a minute`,
  },
  { what: "Workspaces", condition: "With teammates you invite", value: String(free.workspaces) },
  { what: "Files", condition: "PNG, JPG or HEIC, 20 per batch", value: "10 MB each" },
  {
    what: "Fields read",
    condition: "Merchant, date, items, tax, total, category",
    value: "Included",
  },
  { what: "Confidence scores", condition: "Per receipt and per line item", value: "Included" },
  {
    what: "Corrections",
    condition: "Merchant, date, category, currency and totals",
    value: "Included",
  },
  { what: "Line items", condition: "Read and scored", value: "Not editable yet" },
  { what: "CSV and JSON export", condition: "One receipt or the whole workspace", value: "$0" },
  { what: "Payment card", value: "Not needed" },
];

export function Pricing() {
  return (
    <Section className="bg-secondary/25" id="pricing">
      <SectionHead
        id="pricing"
        label="Pricing"
        lead="No card and no time limit. These limits apply to every free account."
        title="One free plan, with clear limits"
      />

      <div className="mt-12 grid items-start gap-8 lg:grid-cols-[minmax(0,0.75fr)_minmax(0,1.25fr)] lg:gap-10">
        <div className="card-sheen relative overflow-hidden rounded-2xl border border-primary/40 bg-card p-6 sm:p-8">
          <div
            aria-hidden
            className="pointer-events-none absolute -top-24 -right-24 size-56 rounded-full bg-primary/15 blur-3xl"
          />
          <div className="relative">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-lg font-semibold">{freePlan.name}</h3>
              <Badge>Available now</Badge>
            </div>
            <p className="mt-4 flex items-baseline gap-2">
              <span className="fc-num font-mono text-6xl font-bold tracking-tight">
                {freePlan.price}
              </span>
              <span className="text-sm text-muted-foreground">no time limit</span>
            </p>
            <p className="mt-4 text-muted-foreground">
              {free.receiptsPerDay} receipts a day and {free.workspaces} workspace, with everything
              listed in the table.
            </p>
            <Link
              className={cn(buttonVariants({ size: "lg" }), "mt-8 w-full text-[0.95rem]")}
              href="/sign-up"
            >
              Start free
              <ArrowRight aria-hidden />
            </Link>
          </div>
        </div>

        <div className="min-w-0">
          <div className="overflow-hidden rounded-xl border border-border bg-card">
            <table className="w-full text-[0.95rem]">
              <caption className="sr-only">Free plan limits</caption>
              <thead>
                <tr className="border-b border-border text-left font-mono text-xs text-muted-foreground">
                  <th className="py-3 pr-4 pl-5 font-normal" scope="col">
                    What
                  </th>
                  <th className="hidden py-3 pr-4 font-normal sm:table-cell" scope="col">
                    Condition
                  </th>
                  <th className="py-3 pr-5 text-right font-normal" scope="col">
                    Free plan
                  </th>
                </tr>
              </thead>
              <tbody>
                {limits.map((row) => (
                  <tr className="border-b border-border/60 last:border-0" key={row.what}>
                    <th className="py-3 pr-4 pl-5 text-left align-top font-medium" scope="row">
                      {row.what}
                      {row.condition && (
                        <span className="mt-0.5 block text-sm font-normal text-muted-foreground sm:hidden">
                          {row.condition}
                        </span>
                      )}
                    </th>
                    <td className="hidden py-3 pr-4 align-top text-sm leading-6 text-muted-foreground sm:table-cell">
                      {row.condition}
                    </td>
                    <td
                      className={cn(
                        "py-3 pr-5 text-right align-top whitespace-nowrap",
                        /\d/.test(row.value)
                          ? "fc-num font-mono text-sm leading-6"
                          : "text-sm leading-6",
                        row.value === "Not editable yet" && "text-muted-foreground",
                      )}
                    >
                      {row.value}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-5 flex flex-col gap-4 rounded-xl border border-dashed border-input/70 p-5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="flex items-center gap-2 font-medium">
                Paid plans
                <Badge variant="secondary">Coming</Badge>
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                Higher daily limits and more workspaces. Need them now? Tell us what you need.
              </p>
            </div>
            <ContactButton className="h-11 shrink-0 px-5" topic="use-case" variant="outline">
              Contact us
            </ContactButton>
          </div>
        </div>
      </div>
    </Section>
  );
}
