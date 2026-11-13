import { NoReadReceipts } from "@/components/dashboard/empty-states";
import { SpendDashboardView, SpendingHeader } from "@/components/dashboard/spend-dashboard";
import { SectionBoundary } from "@/components/section-error";
import { errorFields, logger } from "@/lib/log";
import { logPageRender } from "@/lib/page-event";
import { getReceiptCounts } from "@/lib/receipts";
import { getSpendView } from "@/lib/spend";
import { buttonVariants } from "@receipt-ocr/ui/components/button";
import { Card } from "@receipt-ocr/ui/components/card";
import { ChartNoAxesColumn } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { unstable_rethrow } from "next/navigation";
import { Suspense } from "react";
import { SpendSkeleton } from "./spend-skeleton";

export const metadata: Metadata = { title: "Spending" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function NoSpendingYet() {
  return (
    <>
      <SpendingHeader />
      <Card className="flex flex-col items-start gap-4 p-5 sm:flex-row sm:items-center">
        <ChartNoAxesColumn aria-hidden="true" className="size-5 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1 text-sm">
          <h2 className="font-medium">No spending yet</h2>
          <p className="mt-1 text-muted-foreground">
            Totals by month, category and merchant show here once a receipt has been scanned.
          </p>
        </div>
        <Link className={buttonVariants({ variant: "default" })} href="/app/upload">
          <span className="md:hidden">Scan a receipt</span>
          <span className="max-md:hidden">Add receipts</span>
        </Link>
      </Card>
    </>
  );
}

async function SpendingContent({ searchParams }: { searchParams: SearchParams }) {
  const counts = await getReceiptCounts();
  if (counts.total === 0) return <NoSpendingYet />;
  const read = counts.total - counts.failed - counts.inFlight;
  if (read <= 0) {
    return (
      <>
        <SpendingHeader />
        <NoReadReceipts failed={counts.failed} inFlight={counts.inFlight} />
      </>
    );
  }
  let view: Awaited<ReturnType<typeof getSpendView>> | null = null;
  try {
    view = await getSpendView(await searchParams);
  } catch (error) {
    unstable_rethrow(error);
    logger.error({ event: "spending.load_failed", unit: "log", error: errorFields(error) });
  }
  if (view) return <SpendDashboardView dashboard={view.dashboard} search={view.search} />;
  return (
    <>
      <SpendingHeader />
      <Card className="p-5 text-sm text-muted-foreground" role="status">
        Spending totals couldn&apos;t load just now. Reload the page to try again.
      </Card>
    </>
  );
}

export default function SpendingPage({ searchParams }: { searchParams: SearchParams }) {
  logPageRender("/app/spending");
  return (
    <div className="mx-auto max-w-6xl">
      <SectionBoundary label="Spending">
        <Suspense fallback={<SpendSkeleton />}>
          <SpendingContent searchParams={searchParams} />
        </Suspense>
      </SectionBoundary>
    </div>
  );
}
