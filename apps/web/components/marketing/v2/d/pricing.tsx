import { buttonVariants } from "@receipt-ocr/ui/components/button";
import { cn } from "@receipt-ocr/ui/lib/utils";
import Link from "next/link";
import { comingSoon, freePlan } from "@/components/marketing/content";
import { SectionHead, Tick } from "./primitives";

// content.ts ends the paid-plans line with "Contact us", but there's no contact channel yet.
const coming = comingSoon.map((item) =>
  item.title === "Paid plans"
    ? {
        ...item,
        desc: `Higher daily limits and more workspaces, for when ${freePlan.receiptsPerDay} a day isn't enough.`,
      }
    : item,
);

export function PricingD() {
  return (
    <section aria-labelledby="pricing" className="scroll-mt-20 bg-secondary/60">
      <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 lg:py-28">
        <SectionHead
          eyebrow="Pricing"
          id="pricing"
          lead="No trial clock, no card on file, no surprise invoice in April."
          title={
            <>
              One plan. It costs <span className="d-wonk">nothing.</span>
            </>
          }
        />

        <div className="mt-14 grid items-start gap-12 lg:grid-cols-[1.1fr_0.9fr] lg:gap-16">
          {/* A paper price tag: notched end, punched hole. */}
          <div className="d-lift max-w-xl lg:-rotate-1">
            <div className="relative bg-card py-8 pr-6 pl-14 [clip-path:polygon(2.25rem_0,100%_0,100%_100%,2.25rem_100%,0_50%)] sm:py-10 sm:pr-10 sm:pl-20">
              <span
                aria-hidden
                className="d-tag-hole absolute top-1/2 left-5 size-4 -translate-y-1/2 rounded-full sm:left-7"
              />
              <div className="flex flex-wrap items-end justify-between gap-4">
                <div>
                  <h3 className="d-mono text-xs font-medium tracking-[0.16em] text-muted-foreground uppercase">
                    {freePlan.name}
                  </h3>
                  <p className="d-display mt-2 text-7xl leading-none font-medium sm:text-8xl">
                    {freePlan.price}
                  </p>
                </div>
                <p className="d-mono pb-2 text-sm text-muted-foreground">no time limit</p>
              </div>
              <ul className="mt-8 space-y-3 border-t border-dashed border-[var(--input)] pt-6">
                {freePlan.includes.map((line) => (
                  <li className="flex gap-3 text-[0.95rem] leading-6" key={line}>
                    <Tick className="mt-1 text-[var(--d-accent)]" />
                    {line}
                  </li>
                ))}
              </ul>
              <Link
                className={cn(
                  buttonVariants({ size: "lg" }),
                  "mt-8 h-12 w-full px-6 text-[0.95rem] shadow-none hover:shadow-none sm:w-auto",
                )}
                href="/sign-up"
              >
                Create a free account
              </Link>
            </div>
          </div>

          <div>
            <h3 className="d-display text-2xl font-medium">Still on the workbench</h3>
            <p className="mt-2 text-muted-foreground">
              Not built yet, so not for sale yet. We&apos;ll say so here when they are.
            </p>
            <ul className="mt-6 divide-y divide-border border-y border-border">
              {coming.map((item) => (
                <li className="flex items-start justify-between gap-4 py-5" key={item.title}>
                  <div>
                    <p className="font-medium">{item.title}</p>
                    <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                      {item.desc}
                    </p>
                  </div>
                  <span className="d-mono shrink-0 rounded-full border border-[var(--input)] px-2.5 py-0.5 text-[0.68rem] font-medium tracking-[0.12em] text-muted-foreground uppercase">
                    Coming
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}
