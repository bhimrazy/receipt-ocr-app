import { Badge } from "@receipt-ocr/ui/components/badge";
import { cn } from "@receipt-ocr/ui/lib/utils";
import { Check, Circle } from "lucide-react";
import Link from "next/link";
import { comingSoon } from "@/components/marketing/content";
import { Section, SectionHead, focusRing } from "./primitives";

/** Where one image goes, in order. Grounded in packages/storage (signed URLs) and packages/ai. */
const stops = [
  { where: "Your device", what: "Nothing leaves your phone or computer until you upload it." },
  {
    where: "Private storage",
    what: "Stored under your workspace. It opens only through a signed link that expires after 10 minutes.",
  },
  {
    where: "Google Gemini AI",
    what: "Google's Gemini AI scans the image and returns the merchant, date, line items, tax and total.",
  },
  {
    where: "Your workspace",
    what: "Visible to you and the people you invite. ReceiptOCR admins can access it to handle a support request.",
  },
];

const enforced = [
  "Receipts belong to a workspace. Only its members can see them.",
  "Image links are signed and expire after 10 minutes.",
  "Deleting a receipt deletes its stored image.",
  "Deleting your account deletes every file you stored.",
];

const promised = [
  "We don't sell your data or use it for advertising.",
  "Admins open a workspace only to handle a support request.",
  "You can export everything as CSV at any time, with no fees.",
];

const notYet = [
  { title: "Security certification", desc: "No SOC 2 or other certification yet.", coming: false },
  ...comingSoon
    .filter((item) => item.title !== "Paid plans")
    .map((item) => ({ ...item, coming: true })),
];

function Column({
  title,
  tone,
  children,
}: {
  title: string;
  tone: "primary" | "muted";
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0 rounded-xl border border-border bg-card p-5 sm:p-6">
      <h3 className="flex items-center gap-2 text-base font-semibold">
        <span
          aria-hidden
          className={cn(
            "size-2 rounded-full",
            tone === "primary"
              ? "bg-primary shadow-[0_0_10px_var(--primary)]"
              : "bg-muted-foreground",
          )}
        />
        {title}
      </h3>
      {children}
    </div>
  );
}

const item = "flex gap-3 py-3 text-[0.95rem] leading-6";

export function Trust() {
  return (
    <Section id="data">
      <SectionHead
        id="data"
        label="Privacy"
        lead="Receipts say a lot about a business. Here is where an image goes, what the code enforces today, and what we have not done yet."
        title="Where your receipts go"
      />

      <ol className="mt-12 grid gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-2 lg:grid-cols-4">
        {stops.map((stop, index) => (
          <li className="relative bg-card p-5 sm:p-6" key={stop.where}>
            <span aria-hidden className="font-mono text-xs text-primary">
              {String(index + 1).padStart(2, "0")}
            </span>
            <h3 className="mt-2 font-semibold">{stop.where}</h3>
            <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{stop.what}</p>
          </li>
        ))}
      </ol>

      <div className="mt-6 grid gap-5 lg:grid-cols-[1.25fr_1fr_1fr]">
        <Column title="What the app does today" tone="primary">
          <ul className="mt-2 divide-y divide-border">
            {enforced.map((text) => (
              <li className={item} key={text}>
                <Check aria-hidden className="mt-1 size-4 shrink-0 text-primary" />
                {text}
              </li>
            ))}
          </ul>
        </Column>
        <Column title="What we promise" tone="primary">
          <ul className="mt-2 divide-y divide-border">
            {promised.map((text) => (
              <li className={item} key={text}>
                <Check aria-hidden className="mt-1 size-4 shrink-0 text-primary" />
                {text}
              </li>
            ))}
          </ul>
          <p className="mt-3 text-sm text-muted-foreground">
            Who processes what is listed in the{" "}
            <Link
              className={cn(
                "rounded-sm text-foreground underline decoration-input underline-offset-4 hover:decoration-primary",
                focusRing,
              )}
              href="/privacy"
            >
              privacy policy
            </Link>
            .
          </p>
        </Column>
        <Column title="Not done yet" tone="muted">
          <ul className="mt-2 divide-y divide-border">
            {notYet.map((entry) => (
              <li className={item} key={entry.title}>
                <Circle aria-hidden className="mt-1 size-4 shrink-0 text-muted-foreground" />
                <span>
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-1 font-medium">
                    {entry.title}
                    {entry.coming && <Badge variant="secondary">Coming</Badge>}
                  </span>
                  <span className="text-muted-foreground">{entry.desc}</span>
                </span>
              </li>
            ))}
          </ul>
        </Column>
      </div>
    </Section>
  );
}
