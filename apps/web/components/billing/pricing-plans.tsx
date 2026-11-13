"use client";

import type { PlanTable } from "@receipt-ocr/core/plans";
import { buttonVariants } from "@receipt-ocr/ui/components/button";
import { cn } from "@receipt-ocr/ui/lib/utils";
import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { CurrentPlanResponse } from "@/app/api/plan/route";
import { PlanCard } from "@/components/plan-card";
import { ContactButton } from "@/components/contact-button";
import { CUSTOM_PLAN, freeFeatures, proFeatures } from "@/lib/plan-copy";
import { PRO_PRICE } from "@/lib/pricing";
import { hasSignedInHint } from "@/lib/signed-in-hint";
import { IntervalToggle, type BillingInterval } from "./interval-toggle";

/** The signed-in visitor's active workspace plan, or null (signed out, or the read failed). */
function useCurrentPlan() {
  const [current, setCurrent] = useState<CurrentPlanResponse | null>(null);
  useEffect(() => {
    if (!hasSignedInHint()) return;
    const controller = new AbortController();
    fetch("/api/plan", { signal: controller.signal })
      .then((response) => (response.ok ? (response.json() as Promise<CurrentPlanResponse>) : null))
      .then(setCurrent)
      .catch(() => undefined);
    return () => controller.abort();
  }, []);
  return current;
}

/**
 * Free, Pro and Custom side by side with a monthly/yearly switch (monthly first). Custom has no
 * price; its button opens the support form on "Plans & limits". The page is static, so a
 * signed-in visitor's plan is fetched after load and marked "Your plan".
 * While checkout is closed Free is the featured card and Pro is marked "Opens soon" with no
 * button. Once open, "Get Pro" goes through sign-up to the workspace's billing page, where the
 * checkout opens; sign-up sends a signed-in visitor straight on. Nothing here loads Paddle.
 */
export function PricingPlans({ plans, checkoutOpen }: { plans: PlanTable; checkoutOpen: boolean }) {
  const [interval, setInterval] = useState<BillingInterval>("month");
  const current = useCurrentPlan();
  const yearly = interval === "year";
  const onPro = current?.plan === "pro";

  const freeCta = current ? (
    <Link className={cn(buttonVariants({ variant: "outline" }), "w-full")} href="/app">
      Open the app
    </Link>
  ) : (
    <Link
      className={cn(buttonVariants({ variant: checkoutOpen ? "outline" : "default" }), "w-full")}
      href="/sign-up"
    >
      Start free
    </Link>
  );

  let proCta: React.ReactNode = null;
  if (onPro) {
    proCta = (
      <Link
        className={cn(buttonVariants({ variant: "outline" }), "w-full")}
        href={current.owner ? "/app/settings/billing" : "/app"}
      >
        {current.owner ? "Manage billing" : "Open the app"}
      </Link>
    );
  } else if (checkoutOpen) {
    proCta = (
      <Link
        className={cn(buttonVariants(), "w-full")}
        href={
          current
            ? `/app/settings/billing?interval=${interval}`
            : `/sign-up?redirect=${encodeURIComponent(`/app/settings/billing?interval=${interval}`)}`
        }
      >
        Get Pro <ArrowRight aria-hidden="true" className="size-4" />
      </Link>
    );
  }

  return (
    <div className="flex flex-col items-center gap-8">
      <IntervalToggle onChange={setInterval} value={interval} />
      <div className="grid w-full max-w-md items-stretch gap-5 lg:max-w-none lg:grid-cols-3">
        <PlanCard
          badge={current?.plan === "free" ? "Your plan" : undefined}
          cadence=""
          cta={freeCta}
          description="For getting receipts into a spreadsheet, alone or with a couple of teammates. No card needed."
          featured={!checkoutOpen}
          features={freeFeatures(plans.free)}
          name="Free"
          price="$0"
        />
        <PlanCard
          badge={
            onPro ? "Your plan" : !checkoutOpen ? "Opens soon" : yearly ? "Best value" : undefined
          }
          cadence={yearly ? "a year per workspace" : "a month per workspace"}
          cta={proCta}
          description={
            yearly
              ? `$${(PRO_PRICE.year / 12).toFixed(2)} a month, billed yearly. Plus sales tax or VAT where it applies. Cancel any time.`
              : "Billed monthly. Plus sales tax or VAT where it applies. Cancel any time."
          }
          featured={checkoutOpen}
          features={proFeatures(plans.pro)}
          name="Pro"
          price={`$${yearly ? PRO_PRICE.year : PRO_PRICE.month}`}
        />
        <PlanCard
          cadence=""
          cta={
            <ContactButton className="w-full" topic="use-case" variant="outline">
              {CUSTOM_PLAN.cta}
            </ContactButton>
          }
          description={CUSTOM_PLAN.description}
          features={[...CUSTOM_PLAN.features]}
          name={CUSTOM_PLAN.name}
          price={CUSTOM_PLAN.price}
          quiet
        />
      </div>
    </div>
  );
}
