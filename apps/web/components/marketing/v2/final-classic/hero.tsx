import { PLANS } from "@/lib/plans";
import { HeroDemo } from "./hero-demo";
import { Ctas } from "./primitives";

export function Hero() {
  return (
    <section aria-labelledby="fc-hero-title" className="relative isolate">
      <div aria-hidden className="fc-grid pointer-events-none absolute inset-0 -z-10" />
      <div className="mx-auto grid max-w-6xl grid-cols-[minmax(0,1fr)] items-center gap-x-12 lg:items-start gap-y-12 px-4 pt-12 pb-20 sm:px-6 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:pt-20 lg:pb-28">
        <div className="lg:pt-8">
          <p className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3.5 py-1.5 font-mono text-xs text-muted-foreground">
            <span
              aria-hidden
              className="size-1.5 rounded-full bg-primary shadow-[0_0_10px_var(--primary)]"
            />
            Receipt OCR · Free plan, no card needed
          </p>
          <h1
            className="fc-display mt-6 text-[2.4rem] leading-[1.04] font-bold sm:text-6xl lg:text-[3.6rem]"
            id="fc-hero-title"
          >
            <span className="block">Turn receipt photos into</span>
            <span className="text-gradient block pb-1">spreadsheet rows</span>
          </h1>
          <p className="mt-6 max-w-xl text-lg leading-relaxed text-pretty text-foreground/80">
            Upload a photo of a receipt. receiptOCR reads the merchant, date, line items, tax and
            total, marks each line it is not sure about, and gives you a CSV.
          </p>
          <Ctas className="mt-8 max-sm:max-w-sm" />
          <p className="mt-6 font-mono text-xs leading-relaxed text-muted-foreground">
            {PLANS.free.receiptsPerDay} free receipts a day · PNG, JPG, HEIC · CSV and JSON
          </p>
        </div>
        <HeroDemo />
      </div>
    </section>
  );
}
