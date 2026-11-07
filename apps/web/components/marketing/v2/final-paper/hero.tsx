import { HeroDemo } from "./hero-demo";
import { Ctas, Eyebrow, Scribble } from "./primitives";

export function HeroPaper() {
  return (
    <section aria-labelledby="pp-hero-title" className="pp-grain relative">
      <div className="mx-auto grid max-w-6xl items-center gap-x-12 gap-y-10 px-4 pt-9 pb-16 sm:px-6 lg:grid-cols-[0.9fr_1.1fr] lg:pt-14 lg:pb-24">
        <div>
          <Eyebrow>For freelancers and small businesses</Eyebrow>
          <h1
            className="pp-display mt-5 text-[3.1rem] leading-[0.98] text-balance sm:text-7xl lg:text-[5.2rem]"
            id="pp-hero-title"
          >
            Stop typing in{" "}
            <span className="relative inline-block whitespace-nowrap">
              <span className="pp-wonk">receipts.</span>
              <Scribble className="absolute -bottom-2 left-0 h-4 w-full sm:-bottom-3 sm:h-5" />
            </span>
          </h1>
          <p className="mt-6 max-w-xl text-lg leading-relaxed text-pretty text-muted-foreground sm:mt-7 sm:text-xl">
            Photograph a receipt. ReceiptOCR scans every line, flags the ones it isn&apos;t sure of,
            and hands you a spreadsheet your accountant will like.
          </p>
          <Ctas className="mt-7 sm:mt-9" />
          <p className="pp-mono mt-5 text-[0.8rem] text-muted-foreground">
            Free to start · no card
          </p>
        </div>

        <HeroDemo />
      </div>
    </section>
  );
}
