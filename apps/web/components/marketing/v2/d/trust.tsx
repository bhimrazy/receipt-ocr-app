import { specs } from "@/components/marketing/content";
import { SectionHead } from "./primitives";

const promises = [
  {
    title: "Only your workspace sees them.",
    body: "Your receipts are visible to you and the people you invite to your workspace.",
  },
  {
    title: "Google's Gemini AI does the reading.",
    body: "Each image is sent to Gemini, which reads out the merchant, date, items, tax and total.",
  },
  {
    title: "You can delete anything.",
    body: "Remove any receipt, or your whole account, from Settings.",
  },
  {
    title: "Your data leaves when you want it to.",
    body: "Export a CSV of everything at any time. No export fees.",
  },
];

export function DataNoteD() {
  return (
    <section aria-labelledby="data" className="scroll-mt-20">
      <div className="mx-auto grid max-w-6xl gap-x-14 gap-y-12 px-4 py-20 sm:px-6 lg:grid-cols-[0.8fr_1.2fr] lg:py-28">
        <SectionHead
          eyebrow="Your data"
          id="data"
          lead="Receipts say a lot about a business. Here is exactly what happens to yours, without the legalese."
          title="Where your receipts go."
        />
        <div className="d-sheet relative rounded-sm px-6 py-8 sm:px-10 sm:py-10">
          <span
            aria-hidden
            className="d-stamp d-mono absolute -top-4 right-5 rotate-6 rounded-sm bg-card px-2.5 py-1 text-[0.7rem] font-semibold tracking-[0.16em] uppercase sm:right-8"
          >
            Plain English
          </span>
          <ol className="space-y-7">
            {promises.map((promise, index) => (
              <li className="grid grid-cols-[2rem_1fr] gap-x-3" key={promise.title}>
                <span aria-hidden className="d-mono pt-1 text-sm text-muted-foreground">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <div>
                  <h3 className="d-display text-xl font-medium">{promise.title}</h3>
                  <p className="mt-1.5 leading-relaxed text-muted-foreground">{promise.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}

export function FinePrintD() {
  return (
    <section aria-labelledby="specs" className="border-t border-border">
      <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 lg:py-28">
        <SectionHead
          eyebrow="Specifics"
          id="specs"
          lead="What it takes, what it reads and what it gives back."
          title={
            <>
              The fine print, in <span className="d-wonk">large</span> print.
            </>
          }
        />
        <dl className="mt-12 grid gap-x-16 gap-y-8 md:grid-cols-2">
          {specs.map((spec) => (
            <div key={spec.label}>
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <dt className="d-display shrink-0 text-xl font-medium">{spec.label}</dt>
                <span aria-hidden className="d-leader" />
                <dd className="d-mono ml-auto text-right text-sm font-medium">{spec.value}</dd>
              </div>
              <p className="mt-1.5 text-sm text-muted-foreground">{spec.note}</p>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}
