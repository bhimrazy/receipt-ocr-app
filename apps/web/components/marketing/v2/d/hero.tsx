import { freePlan } from "@/components/marketing/content";
import { Ctas, Eyebrow, Scribble } from "./primitives";
import { ReadCard, ThermalReceipt } from "./receipt";

export function HeroD() {
  return (
    <section aria-labelledby="d-hero-title" className="d-grain relative">
      <div className="mx-auto grid max-w-6xl items-center gap-x-10 gap-y-10 px-4 pt-9 pb-20 sm:px-6 lg:grid-cols-2 lg:pt-16 lg:pb-24">
        <div>
          <Eyebrow>For freelancers and small businesses</Eyebrow>
          <h1
            className="d-display mt-5 text-[3.1rem] leading-[0.98] font-medium text-balance sm:text-7xl lg:text-[5.4rem]"
            id="d-hero-title"
          >
            Tax season, without the{" "}
            <span className="relative inline-block whitespace-nowrap">
              <span className="d-wonk">shoebox.</span>
              <Scribble className="absolute -bottom-2 left-0 h-4 w-full sm:-bottom-3 sm:h-5" />
            </span>
          </h1>
          <p className="mt-5 max-w-xl text-lg sm:mt-7 leading-relaxed text-pretty text-muted-foreground sm:text-xl">
            Photograph your receipts. ReceiptOCR scans the merchant, date, line items, tax and
            total, points out anything it isn&apos;t sure of, and hands you a tidy spreadsheet.
          </p>
          <Ctas className="mt-7 sm:mt-9" />
          <p className="d-mono mt-6 text-[0.8rem] text-muted-foreground">
            <span className="font-semibold text-foreground">{freePlan.price}</span> ·{" "}
            {freePlan.receiptsPerDay} receipts a day · {freePlan.workspaces} workspace · no card
          </p>
        </div>

        <div className="relative mx-auto flex w-full max-w-[24rem] flex-col sm:block sm:h-[42rem] sm:max-w-[37rem] lg:-mr-8 lg:w-[37rem] lg:max-w-none lg:justify-self-end">
          <ThermalReceipt className="d-print d-tilt ml-2 w-[15rem] self-start [--tilt:-4deg] sm:absolute sm:top-0 sm:left-0 sm:ml-0 sm:w-[15.5rem]" />
          <div className="d-settle d-tilt relative -mt-24 w-full max-w-[22rem] self-end [--tilt:1.5deg] sm:absolute sm:top-[13rem] sm:right-0 sm:mt-0">
            <ReadCard />
          </div>
          <p className="d-display d-wonk mt-4 flex items-start gap-2 px-2 text-[1.05rem] leading-snug text-[var(--d-accent)] sm:absolute sm:top-[31rem] sm:left-0 sm:mt-0 sm:w-[13.5rem] sm:px-0">
            <span>The print was smudged, so it says it&apos;s only 61% sure.</span>
            <svg
              aria-hidden
              className="mt-2 hidden h-6 w-10 shrink-0 sm:block"
              fill="none"
              viewBox="0 0 40 24"
            >
              <path
                d="M2 18c10 1 20-3 30-12m0 0-7 0m7 0-1 7"
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="1.8"
              />
            </svg>
          </p>
        </div>
      </div>
    </section>
  );
}
