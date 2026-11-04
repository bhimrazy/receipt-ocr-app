import { cn } from "@receipt-ocr/ui/lib/utils";
import { Check, Clock, Minus } from "lucide-react";
import Link from "next/link";
import { comingSoon } from "../../content";
import { plan } from "./data";
import { SectionHead, container } from "./parts";

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
    what: "The image is stored under your workspace. It opens only through a signed link that expires.",
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
    what: "The record is saved for you and the teammates you invite. Edit it, export it, delete it.",
    spec: "Members only",
  },
];

const enforced = [
  "Receipts belong to a workspace. Only its members can see them.",
  "Image links are signed and expire after 10 minutes.",
  "Deleting a receipt deletes its stored image.",
  "Deleting your account deletes every file you stored.",
  `Uploads are capped: 10 MB an image, 20 a batch, ${plan.receiptsPerDay} a day.`,
];

const promised = [
  "We don't sell your data or use it for advertising.",
  "Export everything as CSV at any time, with no export fees.",
];

const notCertified = "No SOC 2 or other security certification yet.";
const coming = comingSoon.filter((item) => item.title !== "Paid plans");

function Ledger({
  title,
  icon: Icon,
  iconClass,
  items,
  children,
}: {
  title: string;
  icon: typeof Check;
  iconClass: string;
  items: string[];
  children?: React.ReactNode;
}) {
  return (
    <div className="min-w-0">
      <h3 className="border-b border-foreground pb-3 text-sm font-semibold">{title}</h3>
      <ul className="divide-y divide-border">
        {items.map((item) => (
          <li className="flex gap-3 py-3 text-[15px] leading-6" key={item}>
            <Icon aria-hidden="true" className={cn("mt-1 size-4 shrink-0", iconClass)} />
            <span>{item}</span>
          </li>
        ))}
      </ul>
      {children}
    </div>
  );
}

export function Trust() {
  return (
    <section
      aria-labelledby="g-data"
      className={cn(container, "scroll-mt-20 py-16 lg:py-24")}
      id="data"
    >
      <SectionHead
        id="g-data"
        index="03"
        label="Your data"
        lede="You're trusting us with other people's receipts. So here is exactly where an image goes, what the code enforces today, and what we haven't done yet."
        title="Where every receipt goes, in four stops."
      />

      <ol className="mt-14 grid gap-px overflow-hidden rounded-xl border border-(--g-rule-strong) bg-(--g-rule-strong) sm:grid-cols-2 lg:grid-cols-4">
        {flow.map((stop, i) => (
          <li className="relative flex flex-col bg-card p-5 sm:p-6" key={stop.n}>
            <div className="flex items-center gap-3">
              <span className="g-mono flex size-7 items-center justify-center rounded-full border border-primary text-xs text-primary">
                {stop.n}
              </span>
              {i < flow.length - 1 ? (
                <span
                  aria-hidden="true"
                  className="h-px flex-1 bg-[repeating-linear-gradient(to_right,var(--g-rule-strong)_0_4px,transparent_4px_8px)]"
                />
              ) : null}
            </div>
            <h3 className="mt-5 text-lg font-semibold tracking-[-0.01em]">{stop.where}</h3>
            <p className="mt-2 text-[15px] leading-6 text-(--g-ink-2)">{stop.what}</p>
            <p className="g-mono mt-auto pt-6 text-xs text-muted-foreground">{stop.spec}</p>
          </li>
        ))}
      </ol>

      <div className="mt-16 grid gap-x-6 gap-y-12 lg:grid-cols-12">
        <div className="lg:col-span-5">
          <Ledger
            icon={Check}
            iconClass="text-(--g-good)"
            items={enforced}
            title="Enforced in code today"
          />
        </div>
        <div className="lg:col-span-4">
          <Ledger icon={Check} iconClass="text-(--g-good)" items={promised} title="Our commitments">
            <p className="mt-4 text-sm text-muted-foreground">
              The full list of who processes what is in the{" "}
              <Link
                className="rounded-sm text-primary underline underline-offset-4 outline-none hover:text-(--g-primary-hover) focus-visible:ring-2 focus-visible:ring-ring"
                href="/privacy"
              >
                privacy policy
              </Link>
              .
            </p>
          </Ledger>
        </div>
        <div className="lg:col-span-3">
          <Ledger
            icon={Minus}
            iconClass="text-muted-foreground"
            items={[notCertified]}
            title="Not yet"
          >
            <ul className="divide-y divide-border border-t border-border">
              {coming.map((item) => (
                <li className="flex gap-3 py-3 text-[15px] leading-6" key={item.title}>
                  <Clock
                    aria-hidden="true"
                    className="mt-1 size-4 shrink-0 text-muted-foreground"
                  />
                  <span>
                    <span className="flex items-center gap-2 font-medium">
                      {item.title}
                      <span className="rounded-[4px] border border-border px-1 py-px text-[11px] font-medium text-muted-foreground">
                        Coming
                      </span>
                    </span>
                    <span className="text-(--g-ink-2)">{item.desc}</span>
                  </span>
                </li>
              ))}
            </ul>
          </Ledger>
        </div>
      </div>
    </section>
  );
}
