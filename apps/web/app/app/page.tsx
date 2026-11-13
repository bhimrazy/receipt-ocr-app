import {
  PageHeader,
  PageHeaderContent,
  PageHeaderDescription,
  PageHeaderTitle,
} from "@/components/page-header";
import { PanelSkeleton, RowsSkeleton } from "@/components/app-skeletons";
import { SectionBoundary } from "@/components/section-error";
import { ListPoller } from "@/components/processing-poller";
import { ReceiptList } from "@/components/receipt-list";
import { UploadPanel } from "@/components/upload-panel";
import { UpgradeHomeCard } from "@/components/upgrade/upgrade-home-card";
import { formatTimeUntil } from "@/lib/format";
import { Card } from "@receipt-ocr/ui/components/card";
import { Skeleton } from "@receipt-ocr/ui/components/skeleton";
import { cn } from "@receipt-ocr/ui/lib/utils";
import type { ReceiptCounts } from "@receipt-ocr/core";
import {
  ArrowRight,
  CircleAlert,
  CircleCheck,
  Download,
  Loader2,
  ScanText,
  TriangleAlert,
  Upload,
  type LucideIcon,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { unstable_rethrow } from "next/navigation";
import { Suspense } from "react";
import { getCurrentPlan } from "@/lib/plan-limits";
import { getReceiptCounts, getUsageSummary, listRecentReceipts } from "@/lib/receipts";
import { logPageRender } from "@/lib/page-event";
import { getUpgradeOffer } from "@/lib/upgrade-offer";
import { usageRatio, WARM_RATIO } from "@/lib/upgrade-level";

export const metadata: Metadata = { title: "Home" };

const RECENT = 6;

const steps = (batchMax: number): { icon: LucideIcon; title: string; body: string }[] => [
  {
    icon: Upload,
    title: "Add receipts",
    body: `Take photos with your phone, or drop photos or PDFs here. Up to ${batchMax} at a time.`,
  },
  {
    icon: ScanText,
    title: "We scan them",
    body: "The merchant, date, line items, tax and total, usually in a few seconds each.",
  },
  {
    icon: Download,
    title: "Check and export",
    body: "Lines that were hard to read are marked. Correct the details, then download a CSV.",
  },
];

function HowItWorks({ batchMax }: { batchMax: number }) {
  return (
    <Card className="p-5">
      <h2 className="text-sm font-medium">How it works</h2>
      <ol className="mt-4 flex flex-col gap-5">
        {steps(batchMax).map((step) => (
          <li className="flex gap-3" key={step.title}>
            <span className="flex size-8 shrink-0 items-center justify-center rounded-full border border-primary/25 bg-primary/10 text-primary">
              <step.icon aria-hidden="true" className="size-4" />
            </span>
            <div>
              <p className="text-sm font-medium">{step.title}</p>
              <p className="mt-1 text-sm text-muted-foreground">{step.body}</p>
            </div>
          </li>
        ))}
      </ol>
    </Card>
  );
}

type CheckItem = {
  count: number;
  href: string;
  label: string;
  hint: string;
  icon: LucideIcon;
  tone: string;
  spin?: boolean;
};

function ToCheck({ counts }: { counts: ReceiptCounts }) {
  const items: CheckItem[] = [
    {
      count: counts.needsReview,
      href: "/app/receipts?status=needs-review",
      label: "Needs review",
      hint: "A field is missing, the amounts don't add up, or the date is unclear.",
      icon: TriangleAlert,
      tone: "text-warning border-warning/30 bg-warning/10",
    },
    {
      count: counts.failed,
      href: "/app/receipts?status=failed",
      label: "Couldn't scan",
      hint: "Try again, or upload a clearer photo.",
      icon: CircleAlert,
      tone: "text-destructive border-destructive/30 bg-destructive/10",
    },
    {
      count: counts.inFlight,
      href: "/app/receipts?status=processing",
      label: "Scanning now",
      hint: "No action needed. They finish on their own.",
      icon: Loader2,
      tone: "text-primary border-primary/25 bg-primary/10",
      spin: true,
    },
  ];
  const open = items.filter((item) => item.count > 0);

  return (
    <Card className="overflow-hidden">
      <div className="flex items-baseline justify-between gap-3 border-b border-border px-4 py-3">
        <h2 className="text-sm font-medium select-none">To check</h2>
        <span className="font-mono text-xs text-muted-foreground tabular-nums">
          {counts.total} {counts.total === 1 ? "receipt" : "receipts"} in total
        </span>
      </div>
      {open.length === 0 ? (
        <p className="flex items-start gap-3 px-4 py-5 text-sm text-muted-foreground">
          <CircleCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-primary" />
          Nothing to check. Every receipt passed its checks.
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {open.map((item) => (
            <li className="relative" key={item.href}>
              <Link
                data-touch-row=""
                className="group flex items-start gap-3 px-4 py-3.5 outline-none select-none hover:bg-wash-subtle active:bg-wash focus-visible:bg-wash-subtle focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
                href={item.href}
              >
                <span
                  className={cn(
                    "flex size-9 shrink-0 items-center justify-center rounded-full border",
                    item.tone,
                  )}
                >
                  <item.icon
                    aria-hidden="true"
                    className={cn(
                      "size-4",
                      item.spin &&
                        "animate-spin [animation-duration:2s] motion-reduce:animate-none",
                    )}
                  />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-2 text-sm font-medium">
                    {item.label}
                    <span className="font-mono text-base tabular-nums">{item.count}</span>
                  </span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">{item.hint}</span>
                </span>
                <ArrowRight
                  aria-hidden="true"
                  className="mt-2.5 size-4 shrink-0 text-muted-foreground transition group-hover:translate-x-0.5"
                />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

async function HomeTitle() {
  // The sections below report a failed read; the title just stays generic.
  const counts = await getReceiptCounts().catch((error: unknown) => {
    unstable_rethrow(error);
    return null;
  });
  return counts?.total === 0 ? "Scan your first receipt" : "Home";
}

async function UploadSection() {
  const [usage, { policy }, offer] = await Promise.all([
    getUsageSummary(),
    getCurrentPlan(),
    getUpgradeOffer(),
  ]);
  return (
    <UploadPanel
      batchMax={policy.batchMax}
      resetsIn={formatTimeUntil(usage.opensAt)}
      upgrade={offer ? { audience: offer.audience, pro: offer.pro } : null}
      usage={usage}
    />
  );
}

/**
 * The owner's upgrade card, from WARM_RATIO used: earlier, a card would get snoozed long before
 * it mattered. None at the limit, where the upload panel carries the button.
 */
async function UpgradeCard() {
  const offer = await getUpgradeOffer();
  if (!offer || offer.audience !== "owner" || offer.dismissed.home || offer.level === "at") {
    return null;
  }
  if (offer.level === "quiet" && usageRatio(offer.usage) < WARM_RATIO) return null;
  return <UpgradeHomeCard level={offer.level} offer={offer} />;
}

async function CheckSection() {
  const [counts, { policy }] = await Promise.all([getReceiptCounts(), getCurrentPlan()]);
  return (
    <div className="flex flex-col gap-6">
      <ListPoller active={counts.inFlight > 0} counts={counts} />
      {counts.total === 0 ? <HowItWorks batchMax={policy.batchMax} /> : <ToCheck counts={counts} />}
      <UpgradeCard />
    </div>
  );
}

async function RecentSection() {
  const [counts, recent] = await Promise.all([getReceiptCounts(), listRecentReceipts(RECENT)]);
  if (counts.total === 0) return null;

  return (
    <section aria-labelledby="recent-heading" className="mt-10">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="text-base font-semibold" id="recent-heading">
          Recent receipts
        </h2>
        <Link
          className="inline-flex items-center gap-1 rounded-md text-sm font-medium text-primary outline-none select-none hover:underline active:opacity-70 focus-visible:ring-2 focus-visible:ring-ring max-md:min-h-11"
          href="/app/receipts"
        >
          All receipts
          <ArrowRight aria-hidden="true" className="size-4" />
        </Link>
      </div>
      <Card className="overflow-hidden">
        <ReceiptList receipts={recent} />
      </Card>
    </section>
  );
}

export default function HomePage() {
  logPageRender("/app");
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader>
        <PageHeaderContent>
          <PageHeaderTitle>
            <Suspense fallback="Home">
              <HomeTitle />
            </Suspense>
          </PageHeaderTitle>
          <PageHeaderDescription>
            Add a photo of a receipt and we scan the merchant, date, items and total. Several photos
            are scanned in the background while you keep working.
          </PageHeaderDescription>
        </PageHeaderContent>
      </PageHeader>

      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <section aria-label="Upload">
          <SectionBoundary label="Upload">
            <Suspense fallback={<Skeleton className="h-64 w-full rounded-xl" />}>
              <UploadSection />
            </Suspense>
          </SectionBoundary>
        </section>
        <SectionBoundary label="To check">
          <Suspense fallback={<PanelSkeleton />}>
            <CheckSection />
          </Suspense>
        </SectionBoundary>
      </div>

      <SectionBoundary className="mt-10" label="Recent receipts">
        <Suspense
          fallback={
            <div className="mt-10">
              <RowsSkeleton rows={RECENT} />
            </div>
          }
        >
          <RecentSection />
        </Suspense>
      </SectionBoundary>
    </div>
  );
}
