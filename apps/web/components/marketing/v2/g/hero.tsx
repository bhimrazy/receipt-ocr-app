import { cn } from "@receipt-ocr/ui/lib/utils";
import Link from "next/link";
import { ctaClass, ghostClass } from "./chrome";
import { plan } from "./data";
import { Fig, container } from "./parts";
import { ProductComposition } from "./product";

const facts = [
  { value: String(plan.receiptsPerDay), unit: "/ day", label: "receipts on the free plan" },
  { value: "10", unit: "MB", label: "per image, PNG · JPG · HEIC" },
  { value: "20", unit: "files", label: "per batch upload" },
  { value: "CSV", unit: "· JSON", label: "export, no fees" },
];

export function Hero() {
  return (
    <section aria-labelledby="g-hero-title" className="relative">
      <div
        aria-hidden="true"
        className={cn(container, "pointer-events-none absolute inset-x-0 top-0 h-full")}
      >
        <div className="g-guides h-full w-full" />
      </div>
      <div
        className={cn(
          container,
          "relative grid gap-x-6 gap-y-12 pb-16 pt-12 sm:pt-16 lg:grid-cols-12 lg:pb-8 lg:pt-20",
        )}
      >
        <div className="lg:col-span-5 lg:pt-4">
          <p className="text-sm text-(--g-ink-2)">
            For small businesses and the bookkeepers who handle their receipts
          </p>
          <h1
            className="mt-5 text-[40px] font-semibold leading-[1.02] tracking-[-0.035em] text-balance sm:text-[56px] lg:text-[60px]"
            id="g-hero-title"
          >
            Every receipt, scanned line by line.
          </h1>
          <p className="mt-6 max-w-[46ch] text-[17px] leading-7 text-(--g-ink-2) text-pretty">
            Upload a photo or scan. ReceiptOCR extracts the merchant, date, line items, tax and
            total, scores how sure it is of each line, and exports the record you approve as CSV.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Link className={ctaClass} href="/sign-up">
              Start free
            </Link>
            <Link className={ghostClass} href="#data">
              See where your data goes
            </Link>
          </div>
          <p className="mt-4 text-sm text-muted-foreground">
            <span className="font-medium text-foreground">{plan.price}</span> ·{" "}
            {plan.receiptsPerDay} receipts a day · No card · No time limit
          </p>
        </div>

        <div className="min-w-0 lg:col-span-7">
          <ProductComposition />
          <div className="mt-3">
            <Fig n="1">
              One receipt beside the record scanned from it. The 61% line is flagged for you to
              check.
            </Fig>
          </div>
        </div>

        <dl className="grid grid-cols-2 border-t border-foreground sm:grid-cols-4 lg:col-span-12">
          {facts.map((fact, i) => (
            <div
              className={cn(
                "border-border py-5 pr-4",
                i % 2 === 1 && "border-l pl-4 sm:pl-5",
                i >= 2 && "border-t sm:border-t-0",
                i === 2 && "sm:border-l sm:pl-5",
              )}
              key={fact.label}
            >
              <dt className="sr-only">{fact.label}</dt>
              <dd>
                <span className="g-num text-[28px] font-semibold tracking-[-0.02em] sm:text-[32px]">
                  {fact.value}
                </span>
                <span className="ml-1.5 text-sm text-muted-foreground">{fact.unit}</span>
                <p aria-hidden="true" className="mt-1 text-sm text-(--g-ink-2)">
                  {fact.label}
                </p>
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}
