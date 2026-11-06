import { cn } from "@receipt-ocr/ui/lib/utils";
import { SectionHead } from "./primitives";

function Files() {
  const files = [
    { name: "IMG_4021.HEIC", size: "2.4 MB", tilt: "[--tilt:-2deg]" },
    { name: "scan-0193.jpg", size: "812 KB", tilt: "[--tilt:1.5deg] ml-4" },
    { name: "lunch-friday.png", size: "1.1 MB", tilt: "[--tilt:-0.5deg] ml-1" },
  ];
  return (
    <ul aria-label="Example uploads" className="space-y-2.5">
      {files.map((file) => (
        <li
          className={cn(
            "d-sheet d-tilt d-mono flex items-center justify-between gap-3 rounded-md px-3.5 py-2.5 text-xs",
            file.tilt,
          )}
          key={file.name}
        >
          <span className="truncate font-medium">{file.name}</span>
          <span className="text-muted-foreground">{file.size}</span>
        </li>
      ))}
    </ul>
  );
}

function Fix() {
  return (
    <div className="d-sheet rounded-lg p-4" role="img" aria-label="Editing a flagged line item">
      <p className="text-xs text-muted-foreground">Item</p>
      <p className="mt-1 rounded-md border border-[var(--input)] bg-background/60 px-3 py-2 text-sm">
        USB-C cable 2m
        <span className="ml-px inline-block h-4 w-px translate-y-0.5 bg-foreground" />
      </p>
      <div className="mt-3 flex items-end justify-between gap-3">
        <div>
          <p className="text-xs text-muted-foreground">Amount</p>
          <p className="d-mono mt-1 rounded-md border border-[var(--input)] bg-background/60 px-3 py-2 text-sm">
            $14.99
          </p>
        </div>
        <span className="d-stamp d-mono -rotate-6 rounded-sm px-2 py-1 text-[0.7rem] font-semibold tracking-[0.14em] uppercase">
          Checked
        </span>
      </div>
    </div>
  );
}

function Export() {
  return (
    <div className="flex items-end gap-4" role="img" aria-label="A CSV file and a JSON copy">
      <div className="d-sheet relative h-28 w-24 rounded-sm [clip-path:polygon(0_0,72%_0,100%_22%,100%_100%,0_100%)]">
        <div className="absolute top-0 right-0 size-[1.6rem] bg-secondary" />
        <span className="d-mono absolute bottom-3 left-3 text-sm font-semibold">.csv</span>
      </div>
      <div className="d-sheet d-mono rounded-md px-3 py-2 text-[0.7rem] leading-5 text-muted-foreground">
        {"{ "}
        <span className="text-foreground">&quot;total&quot;</span>: 86.85 {"}"}
      </div>
    </div>
  );
}

const steps = [
  {
    title: "Drop them in.",
    body: "Phone photos or scans: PNG, JPG or HEIC, up to 10 MB each and 20 at a time. They're read one after another while you get a coffee.",
    visual: <Files />,
  },
  {
    title: "Check the bits it flags.",
    body: "Every receipt, and every line on it, gets a confidence score. Low ones show you where to look. Fix the merchant, date, category or amounts right there.",
    visual: <Fix />,
  },
  {
    title: "Export, and get on with your day.",
    body: "Download a CSV for one receipt or the whole workspace, or copy a receipt as JSON. No export fees, no lock-in.",
    visual: <Export />,
  },
];

export function HowD() {
  return (
    <section aria-labelledby="how" className="scroll-mt-20 bg-secondary/60">
      <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 lg:py-28">
        <SectionHead
          eyebrow="How it works"
          id="how"
          lead="receiptOCR does the reading. You decide what goes in your books."
          title={
            <>
              Three steps. The middle one is <span className="d-wonk">you.</span>
            </>
          }
        />
        <ol className="mt-14 border-b border-[var(--input)]/50">
          {steps.map((step, index) => (
            <li
              className={cn(
                "grid grid-cols-[2.75rem_1fr] gap-x-4 gap-y-6 border-t border-[var(--input)]/50 py-10 md:grid-cols-[6rem_1fr_17rem] md:gap-10 lg:grid-cols-[8rem_1fr_19rem]",
              )}
              key={step.title}
            >
              <span
                aria-hidden
                className="d-display d-wonk text-5xl leading-none text-[var(--d-accent)] md:text-7xl"
              >
                {index + 1}
              </span>
              <div className="max-w-md">
                <h3 className="d-display text-2xl font-medium sm:text-[1.75rem]">
                  <span className="sr-only">Step {index + 1}: </span>
                  {step.title}
                </h3>
                <p className="mt-3 leading-relaxed text-muted-foreground">{step.body}</p>
              </div>
              <div className="col-start-2 max-w-xs md:col-start-auto md:max-w-none">
                {step.visual}
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
