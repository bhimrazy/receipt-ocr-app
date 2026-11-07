import { cn } from "@receipt-ocr/ui/lib/utils";
import Link from "next/link";
import { comingSoon } from "@/components/marketing/content";
import { PLANS } from "@/lib/plans";
import { SectionHead, Tick, focusRing } from "./primitives";

const free = PLANS.free;

/** Where one image goes, in order. Grounded in packages/storage (signed URLs) and packages/ai. */
const stops = [
  {
    where: "Your phone or computer",
    what: "Nothing leaves your device until you upload it.",
  },
  {
    where: "Private storage",
    what: "The image is stored under your workspace and opens only through a signed link that expires after 10 minutes.",
  },
  {
    where: "Google's Gemini AI",
    what: "Gemini scans the image and sends back the merchant, date, items, tax and total.",
  },
  {
    where: "Your workspace",
    what: "Only you and the people you invite to your workspace. ReceiptOCR admins can access an account only to handle a support request.",
  },
];

const enforced = [
  "Receipts belong to a workspace, and only its members can see them.",
  "Image links are signed and expire after 10 minutes.",
  "Deleting a receipt deletes its stored image.",
  "Deleting your account deletes every file you stored.",
  `Uploads are capped: 10 MB an image, 20 a batch, ${free.receiptsPerDay} a day. The count resets at 00:00 UTC, and a service-wide daily cap can apply first.`,
];

const promised = [
  "We don't sell your data or use it for advertising.",
  "Admins open an account only to handle a support request.",
  "Export everything as CSV at any time, with no export fees.",
];

const notYet = [
  { title: "Security certification", desc: "No SOC 2 or other certification yet." },
  ...comingSoon.filter((item) => item.title !== "Paid plans"),
];

function Column({
  title,
  children,
  className,
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("min-w-0", className)}>
      <h3 className="pp-display border-b border-foreground pb-3 text-xl">{title}</h3>
      {children}
    </div>
  );
}

export function TrustPaper() {
  return (
    <section aria-labelledby="data" className="scroll-mt-20">
      <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 lg:py-28">
        <div className="grid gap-x-14 gap-y-12 lg:grid-cols-[0.75fr_1.25fr]">
          <SectionHead
            eyebrow="Your data"
            id="data"
            lead="Receipts say a lot about a business. Here is where an image goes, what the code enforces today, and what we haven't done yet."
            title="Where your receipts go."
          />
          <div className="pp-sheet relative rounded-sm px-6 py-8 sm:px-10 sm:py-10">
            <span
              aria-hidden
              className="pp-stamp pp-mono absolute -top-4 right-5 -rotate-1 rounded-sm bg-card px-2.5 py-1 text-[0.75rem] font-medium tracking-[0.16em] uppercase sm:right-8"
            >
              Plain English
            </span>
            <ol className="space-y-6">
              {stops.map((stop, index) => (
                <li className="grid grid-cols-[2rem_1fr] gap-x-3" key={stop.where}>
                  <span aria-hidden className="pp-mono pt-1 text-sm text-muted-foreground">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <div>
                    <h3 className="pp-display text-xl">{stop.where}</h3>
                    <p className="mt-1.5 leading-relaxed text-muted-foreground">{stop.what}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </div>

        <div className="mt-16 grid gap-x-10 gap-y-12 lg:mt-20 lg:grid-cols-[1.2fr_1fr_1fr]">
          <Column title="Enforced in code today">
            <ul className="divide-y divide-border">
              {enforced.map((item) => (
                <li className="flex gap-3 py-3 text-[0.95rem] leading-6" key={item}>
                  <Tick className="mt-1 text-[var(--pp-accent)]" />
                  {item}
                </li>
              ))}
            </ul>
          </Column>
          <Column title="Our commitments">
            <ul className="divide-y divide-border">
              {promised.map((item) => (
                <li className="flex gap-3 py-3 text-[0.95rem] leading-6" key={item}>
                  <Tick className="mt-1 text-[var(--pp-accent)]" />
                  {item}
                </li>
              ))}
            </ul>
            <p className="mt-4 text-sm text-muted-foreground">
              Who processes what is listed in the{" "}
              <Link
                className={cn(
                  "rounded-sm text-foreground underline decoration-[var(--input)] underline-offset-4 hover:decoration-foreground",
                  focusRing,
                )}
                href="/privacy"
              >
                privacy policy
              </Link>
              .
            </p>
          </Column>
          <Column title="Not yet">
            <ul className="divide-y divide-border">
              {notYet.map((item) => (
                <li className="py-3 text-[0.95rem] leading-6" key={item.title}>
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-1 font-medium">
                    {item.title}
                    {item.title !== "Security certification" && (
                      <span className="pp-mono rounded-full border border-[var(--input)] px-2 py-px text-[0.75rem] font-normal text-muted-foreground">
                        Coming
                      </span>
                    )}
                  </span>
                  <span className="text-muted-foreground">{item.desc}</span>
                </li>
              ))}
            </ul>
          </Column>
        </div>
      </div>
    </section>
  );
}
