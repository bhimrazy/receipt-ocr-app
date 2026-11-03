import { buttonVariants } from "@receipt-ocr/ui/components/button";
import { cn } from "@receipt-ocr/ui/lib/utils";
import { ArrowRight, Check } from "lucide-react";
import Link from "next/link";
import { ContactButton } from "@/components/contact-button";
import { comingSoon, freePlan } from "./content";

/** The real free plan (lib/plans.ts). Paid tiers are not sold yet, so they only appear as "coming". */
export function FreePlanCard({ className }: { className?: string }) {
  return (
    <div className={cn("card-sheen flex flex-col rounded-2xl bg-card p-7 ring-1 ring-primary/35", className)}>
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-lg font-semibold">{freePlan.name}</h3>
        <span className="rounded-full bg-primary/12 px-2.5 py-0.5 text-xs font-medium text-primary">Available now</span>
      </div>
      <p className="mt-4 flex items-baseline gap-2">
        <span className="font-mono text-4xl font-bold tracking-tight">{freePlan.price}</span>
        <span className="text-sm text-muted-foreground">no card, no time limit</span>
      </p>
      <ul className="mt-6 flex flex-1 flex-col gap-3 text-sm">
        {freePlan.includes.map((feature) => (
          <li className="flex items-start gap-2.5" key={feature}>
            <Check aria-hidden className="mt-0.5 size-4 shrink-0 text-primary" />
            <span>{feature}</span>
          </li>
        ))}
      </ul>
      <Link className={cn(buttonVariants({ size: "lg" }), "mt-8 w-full")} href="/sign-up">
        Get started free <ArrowRight aria-hidden className="size-4" />
      </Link>
    </div>
  );
}

export function ComingSoonCard({ className }: { className?: string }) {
  return (
    <div className={cn("flex flex-col rounded-2xl bg-secondary/30 p-7 ring-1 ring-border", className)}>
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-lg font-semibold">On the way</h3>
        <span className="rounded-full bg-foreground/[0.06] px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
          Coming soon
        </span>
      </div>
      <p className="mt-4 text-sm leading-6 text-muted-foreground">
        Not built yet, so not for sale yet. Tell us what you need and we&apos;ll reply by email.
      </p>
      <ul className="mt-6 flex flex-1 flex-col gap-4 text-sm">
        {comingSoon.map((item) => (
          <li key={item.title}>
            <p className="font-medium">{item.title}</p>
            <p className="mt-0.5 text-muted-foreground">{item.desc}</p>
          </li>
        ))}
      </ul>
      <ContactButton className="mt-8 w-full" size="lg" topic="use-case" variant="outline">
        Contact us
      </ContactButton>
    </div>
  );
}
