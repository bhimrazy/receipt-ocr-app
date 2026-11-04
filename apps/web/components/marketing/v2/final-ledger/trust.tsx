import { cn } from "@receipt-ocr/ui/lib/utils";
import { Check, Clock, Minus } from "lucide-react";
import Link from "next/link";
import { comingSoon } from "../../content";
import { ComingTag, Fig, SectionHead, container } from "./parts";

const flow = [
  {
    n: "A",
    where: "Your device",
    what: "You pick the file. Nothing leaves your phone or computer until you upload it.",
    spec: "PNG · JPG · HEIC · ≤ 10 MB",
  },
  {
    n: "B",
    where: "Private storage",
    what: "The image is stored under your workspace and opens only through a signed link that expires.",
    spec: "Signed links · 10 min expiry",
  },
  {
    n: "C",
    where: "Google Gemini",
    what: "Google's Gemini model reads the image and returns the fields, under Google's Gemini API terms.",
    spec: "Named in our privacy policy",
  },
  {
    n: "D",
    where: "Your workspace",
    what: "The record is kept for you and the people you invite. Edit it, export it, delete it.",
    spec: "You and your invitees",
  },
];

const enforced = [
  "Every receipt request is checked against workspace membership.",
  "Image links are signed and expire after 10 minutes.",
  "Deleting a receipt deletes its stored image.",
  "Deleting your account deletes the image files you stored.",
  "Each image is capped at 10 MB.",
];

const promised = [
  "We don't sell your data or use it for advertising.",
  "receiptOCR admins access an account only to handle a support request.",
  "Export everything as CSV whenever you like, with no export fees.",
];

const coming = comingSoon.filter((item) => item.title !== "Paid plans");

function ListHead({ children }: { children: React.ReactNode }) {
  return <h3 className="border-b border-foreground pb-3 text-sm font-semibold">{children}</h3>;
}

function Ticks({ items }: { items: string[] }) {
  return (
    <ul className="divide-y divide-border">
      {items.map((item) => (
        <li className="flex gap-3 py-3 text-[15px] leading-6" key={item}>
          <Check aria-hidden="true" className="mt-1 size-4 shrink-0 text-primary" />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

export function Trust() {
  return (
    <section
      aria-labelledby="fl-data"
      className={cn(container, "scroll-mt-20 py-16 lg:py-24")}
      id="data"
    >
      <SectionHead
        id="fl-data"
        index="03"
        label="Your data"
        lede="You're handing us receipts, and sometimes they're your clients'. Here is exactly where an image goes, what the code enforces today, and what we haven't done yet."
        title="Where every receipt goes, in four stops."
      />

      <ol className="mt-12 grid border-t border-foreground sm:grid-cols-2 lg:grid-cols-4">
        {flow.map((stop, i) => (
          <li
            className={cn(
              "flex flex-col border-b border-border py-5 sm:pr-5 lg:border-b-0 lg:pb-2",
              i % 2 === 1 && "sm:border-l sm:pl-5",
              i === 2 && "lg:border-l lg:pl-5",
            )}
            key={stop.n}
          >
            <p className="flex items-center gap-3">
              <span className="fl-mono text-sm text-primary">{stop.n}</span>
              {i < flow.length - 1 ? (
                <span
                  aria-hidden="true"
                  className="h-px flex-1 bg-[repeating-linear-gradient(to_right,var(--fl-rule-strong)_0_4px,transparent_4px_8px)]"
                />
              ) : null}
            </p>
            <h3 className="mt-4 text-lg font-semibold tracking-[-0.01em]">{stop.where}</h3>
            <p className="mt-2 text-[15px] leading-6 text-(--fl-ink-2)">{stop.what}</p>
            <p className="fl-mono mt-auto pt-5 text-xs text-muted-foreground">{stop.spec}</p>
          </li>
        ))}
      </ol>
      <div className="mt-4 border-t border-border pt-3">
        <Fig n="4">The path of one image, from your phone to your workspace.</Fig>
      </div>

      <div className="mt-14 grid gap-x-6 gap-y-12 lg:grid-cols-12">
        <div className="lg:col-span-5">
          <ListHead>Enforced in code today</ListHead>
          <Ticks items={enforced} />
        </div>
        <div className="lg:col-span-4">
          <ListHead>Our commitments</ListHead>
          <Ticks items={promised} />
          <p className="mt-2 text-sm text-muted-foreground">
            Who processes what is listed in the{" "}
            <Link
              className="-mx-1 inline-flex min-h-11 items-center rounded-sm px-1 text-primary underline underline-offset-4 outline-none hover:text-(--fl-primary-hover) focus-visible:ring-2 focus-visible:ring-ring"
              href="/privacy"
            >
              privacy policy
            </Link>
            .
          </p>
        </div>
        <div className="lg:col-span-3">
          <ListHead>Not yet</ListHead>
          <ul className="divide-y divide-border">
            {coming.map((item) => (
              <li className="flex gap-3 py-3 text-[15px] leading-6" key={item.title}>
                <Clock aria-hidden="true" className="mt-1 size-4 shrink-0 text-muted-foreground" />
                <span>
                  <span className="flex flex-wrap items-center gap-2 font-medium">
                    {item.title}
                    <ComingTag />
                  </span>
                  <span className="text-(--fl-ink-2)">{item.desc}</span>
                </span>
              </li>
            ))}
            <li className="flex gap-3 py-3 text-[15px] leading-6">
              <Minus aria-hidden="true" className="mt-1 size-4 shrink-0 text-muted-foreground" />
              <span>No SOC 2 or other security certification yet.</span>
            </li>
          </ul>
        </div>
      </div>
    </section>
  );
}
