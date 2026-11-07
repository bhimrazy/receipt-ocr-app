import {
  PageHeader,
  PageHeaderContent,
  PageHeaderDescription,
  PageHeaderTitle,
} from "@/components/page-header";
import { PanelSkeleton, RowsSkeleton } from "@/components/app-skeletons";
import { ListPoller } from "@/components/processing-poller";
import { ReceiptList } from "@/components/receipt-list";
import { NoReadReceipts } from "@/components/dashboard/empty-states";
import { SpendDashboardView } from "@/components/dashboard/spend-dashboard";
import { UploadPanel } from "@/components/upload-panel";
import { formatTimeUntil } from "@/lib/format";
import { errorFields, logger } from "@/lib/log";
import { getSpendView } from "@/lib/spend";
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
import { Suspense } from "react";
import { getCurrentPlan } from "@/lib/plan-limits";
import { getReceiptCounts, getUsageSummary, listReceiptSummaries } from "@/lib/receipts";
import { logPageRender } from "@/lib/page-event";

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
    title: "We read them",
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
      href: "/app/history?status=needs-review",
      label: "Needs review",
      hint: "Read with low confidence. Compare them with the photo.",
      icon: TriangleAlert,
      tone: "text-warning border-warning/30 bg-warning/10",
    },
    {
      count: counts.failed,
      href: "/app/history?status=failed",
      label: "Couldn't read",
      hint: "Try again, or upload a clearer photo.",
      icon: CircleAlert,
      tone: "text-destructive border-destructive/30 bg-destructive/10",
    },
    {
      count: counts.inFlight,
      href: "/app/history?status=processing",
      label: "Reading now",
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
        <h2 className="text-sm font-medium">To check</h2>
        <span className="font-mono text-xs text-muted-foreground tabular-nums">
          {counts.total} {counts.total === 1 ? "receipt" : "receipts"} in total
        </span>
      </div>
      {open.length === 0 ? (
        <p className="flex items-start gap-3 px-4 py-5 text-sm text-muted-foreground">
          <CircleCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-primary" />
          Nothing to check. Every receipt was read with high confidence.
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {open.map((item) => (
            <li className="relative" key={item.href}>
              <Link
                className="group flex items-start gap-3 px-4 py-3.5 outline-none hover:bg-wash-subtle focus-visible:bg-wash-subtle focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
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
  const counts = await getReceiptCounts();
  return counts.total === 0 ? "Read your first receipt" : "Home";
}

async function UploadSection() {
  const [usage, { policy }] = await Promise.all([getUsageSummary(), getCurrentPlan()]);
  return (
    <UploadPanel
      batchMax={policy.batchMax}
      resetsIn={formatTimeUntil(usage.resetsAt)}
      usage={usage}
    />
  );
}

async function CheckSection() {
  const [counts, { policy }] = await Promise.all([getReceiptCounts(), getCurrentPlan()]);
  return (
    <>
      <ListPoller active={counts.inFlight > 0} counts={counts} />
      {counts.total === 0 ? <HowItWorks batchMax={policy.batchMax} /> : <ToCheck counts={counts} />}
    </>
  );
}

async function RecentSection() {
  const [counts, recent] = await Promise.all([
    getReceiptCounts(),
    listReceiptSummaries({ pageSize: RECENT }),
  ]);
  if (counts.total === 0) return null;

  return (
    <section aria-labelledby="recent-heading" className="mt-10">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="text-base font-semibold" id="recent-heading">
          Recent receipts
        </h2>
        <Link
          className="inline-flex items-center gap-1 rounded-md text-sm font-medium text-primary outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring max-md:min-h-11"
          href="/app/history"
        >
          All receipts
          <ArrowRight aria-hidden="true" className="size-4" />
        </Link>
      </div>
      <Card className="overflow-hidden">
        <ReceiptList receipts={recent.rows} />
      </Card>
    </section>
  );
}

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function SpendSkeleton() {
  return (
    <div aria-hidden="true" className="mt-10 flex flex-col gap-4">
      <Skeleton className="h-5 w-32" />
      <Skeleton className="h-9 w-full max-w-lg rounded-full" />
      <Skeleton className="h-72 w-full rounded-lg" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton
            className={cn("h-28 rounded-lg", i === 0 && "col-span-2 lg:col-span-1")}
            key={i}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * The spending dashboard. Skipped for an empty workspace (the upload and
 * how-it-works content is the whole page then), and without a query while
 * nothing has been read yet: both follow from the counts the page already has.
 */
async function SpendSection({ searchParams }: { searchParams: SearchParams }) {
  const counts = await getReceiptCounts();
  if (counts.total === 0) return null;
  const read = counts.total - counts.failed - counts.inFlight;
  if (read <= 0) {
    return (
      <section aria-labelledby="spending-heading" className="mt-10">
        <h2 className="mb-3 text-base font-semibold" id="spending-heading">
          Spending
        </h2>
        <NoReadReceipts failed={counts.failed} inFlight={counts.inFlight} />
      </section>
    );
  }
  let view: Awaited<ReturnType<typeof getSpendView>> | null = null;
  try {
    view = await getSpendView(await searchParams);
  } catch (error) {
    // The rest of Home still works; don't let the dashboard take it down.
    logger.error({ event: "home.spend_failed", unit: "log", error: errorFields(error) });
  }
  if (view) return <SpendDashboardView dashboard={view.dashboard} search={view.search} />;
  return (
    <section aria-labelledby="spending-heading" className="mt-10">
      <h2 className="mb-3 text-base font-semibold" id="spending-heading">
        Spending
      </h2>
      <Card className="p-5 text-sm text-muted-foreground" role="status">
        Spending totals couldn&apos;t load just now. Reload the page to try again.
      </Card>
    </section>
  );
}

export default function HomePage({ searchParams }: { searchParams: SearchParams }) {
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
            Add a photo of a receipt and we read the merchant, date, items and total. Several photos
            are read in the background while you keep working.
          </PageHeaderDescription>
        </PageHeaderContent>
      </PageHeader>

      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <section aria-label="Upload">
          <Suspense fallback={<Skeleton className="h-64 w-full rounded-xl" />}>
            <UploadSection />
          </Suspense>
        </section>
        <Suspense fallback={<PanelSkeleton />}>
          <CheckSection />
        </Suspense>
      </div>

      <Suspense fallback={<SpendSkeleton />}>
        <SpendSection searchParams={searchParams} />
      </Suspense>

      <Suspense
        fallback={
          <div className="mt-10">
            <RowsSkeleton rows={RECENT} />
          </div>
        }
      >
        <RecentSection />
      </Suspense>
    </div>
  );
}
