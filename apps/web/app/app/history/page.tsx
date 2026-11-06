import { RowsSkeleton } from "@/components/app-skeletons";
import { exportHref, isFiltered } from "@/components/history/history-href";
import { HistoryResults } from "@/components/history/history-results";
import { HistoryToolbar } from "@/components/history/history-toolbar";
import {
  PageHeader,
  PageHeaderActions,
  PageHeaderContent,
  PageHeaderDescription,
  PageHeaderTitle,
} from "@/components/page-header";
import { ListPoller } from "@/components/processing-poller";
import { isInFlight } from "@/components/receipt-status";
import {
  cleanFilters,
  filtersFromSearchParams,
  getReceiptCounts,
  listReceiptSummaries,
  type ReceiptListFilters,
} from "@/lib/receipts";
import { buttonVariants } from "@receipt-ocr/ui/components/button";
import { Skeleton } from "@receipt-ocr/ui/components/skeleton";
import { Download } from "lucide-react";
import type { Metadata } from "next";
import { Suspense, cache } from "react";

export const metadata: Metadata = { title: "History" };

// Keyed by a string so the header summary and the results share one query per request.
const loadPage = cache((key: string) =>
  listReceiptSummaries(JSON.parse(key) as ReceiptListFilters),
);

async function Summary({ query }: { query: string }) {
  const { total, page, pageSize } = await loadPage(query);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <>
      {total} {total === 1 ? "receipt" : "receipts"} in this workspace
      {totalPages > 1 ? ` · page ${page} of ${totalPages}` : ""}
    </>
  );
}

async function Results({ query, filters }: { query: string; filters: ReceiptListFilters }) {
  const [{ rows, total, page, pageSize }, counts] = await Promise.all([
    loadPage(query),
    getReceiptCounts(),
  ]);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <>
      <ListPoller active={rows.some((receipt) => isInFlight(receipt.status))} counts={counts} />
      <HistoryResults filters={filters} page={page} receipts={rows} totalPages={totalPages} />
    </>
  );
}

export default async function HistoryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { page: requested, ...raw } = filtersFromSearchParams(await searchParams);
  const filters = cleanFilters(raw);
  const query = JSON.stringify({ ...filters, page: requested });

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader>
        <PageHeaderContent>
          <PageHeaderTitle>History</PageHeaderTitle>
          <PageHeaderDescription>
            <Suspense fallback={<Skeleton className="h-5 w-48" />}>
              <Summary query={query} />
            </Suspense>
          </PageHeaderDescription>
        </PageHeaderContent>
        <PageHeaderActions>
          <a className={buttonVariants({ variant: "outline" })} href={exportHref(filters)}>
            <Download aria-hidden="true" />
            {isFiltered(filters) ? "Export filtered CSV" : "Export CSV"}
          </a>
        </PageHeaderActions>
      </PageHeader>
      <Suspense fallback={<Skeleton className="h-11 w-full" />}>
        <HistoryToolbar filters={filters} />
      </Suspense>
      <Suspense fallback={<RowsSkeleton />} key={query}>
        <Results filters={filters} query={query} />
      </Suspense>
    </div>
  );
}
