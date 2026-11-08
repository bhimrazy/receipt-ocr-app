"use client";

import type { PlanTable } from "@receipt-ocr/core/plans";
import { buttonVariants } from "@receipt-ocr/ui/components/button";
import { cn } from "@receipt-ocr/ui/lib/utils";
import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { PlanCard } from "@/components/plan-card";
import { freeFeatures, proFeatures } from "@/lib/plan-copy";
import { PRO_PRICE } from "@/lib/pricing";
import { IntervalToggle, type BillingInterval } from "./interval-toggle";

/**
 * Free and Pro side by side with a monthly/yearly switch. "Get Pro" goes to the
 * workspace's billing page (sign-in first), where the checkout opens; nothing
 * here loads Paddle. While billing is off, Pro shows its price without a button.
 */
export function PricingPlans({ plans, checkoutOpen }: { plans: PlanTable; checkoutOpen: boolean }) {
  const [interval, setInterval] = useState<BillingInterval>("year");
  const yearly = interval === "year";
  return (
    <div className="flex flex-col items-center gap-8">
      <IntervalToggle onChange={setInterval} value={interval} />
      <div className="grid w-full max-w-3xl items-stretch gap-5 md:grid-cols-2">
        <PlanCard
          cadence=""
          cta={
            <Link className={cn(buttonVariants({ variant: "outline" }), "w-full")} href="/sign-up">
              Start free
            </Link>
          }
          description="For one person getting receipts into a spreadsheet. No card needed."
          features={freeFeatures(plans.free)}
          name="Free"
          price="$0"
        />
        <PlanCard
          badge={yearly ? "Best value" : undefined}
          cadence={yearly ? "a year per workspace" : "a month per workspace"}
          cta={
            checkoutOpen ? (
              <Link
                className={cn(buttonVariants(), "w-full")}
                href={`/app/settings/billing?interval=${interval}`}
              >
                Get Pro <ArrowRight aria-hidden="true" className="size-4" />
              </Link>
            ) : (
              <p className="rounded-md border border-border px-3 py-2.5 text-center text-sm text-muted-foreground">
                Pro checkout opens soon.
              </p>
            )
          }
          description={
            yearly
              ? `$${(PRO_PRICE.year / 12).toFixed(2)} a month, billed yearly. Plus sales tax or VAT where it applies.`
              : "Billed monthly. Plus sales tax or VAT where it applies."
          }
          featured
          features={proFeatures(plans.pro)}
          name="Pro"
          price={`$${yearly ? PRO_PRICE.year : PRO_PRICE.month}`}
        />
      </div>
    </div>
  );
}
