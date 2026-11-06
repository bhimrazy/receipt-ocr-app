import { RowsSkeleton } from "@/components/app-skeletons";
// groups: filter chips and selection mode
import { GroupFilter } from "@/components/groups/group-filter";
import { GroupSelectList } from "@/components/groups/group-select-list";
import { SELECT_PARAM } from "@/components/groups/hrefs";
import { getWorkspaceGroups } from "@/lib/groups";
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

async function Results({
  query,
  filters,
  selecting,
}: {
  query: string;
  filters: ReceiptListFilters;
  selecting: boolean;
}) {
  const [{ rows, total, page, pageSize }, counts] = await Promise.all([
    loadPage(query),
    getReceiptCounts(),
  ]);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <>
      <ListPoller active={rows.some((receipt) => isInFlight(receipt.status))} counts={counts} />
      {/* groups: selection mode for bulk "Add to group" */}
      {selecting ? (
        <GroupSelectList groups={await getWorkspaceGroups()} receipts={rows} />
      ) : (
        <HistoryResults filters={filters} page={page} receipts={rows} totalPages={totalPages} />
      )}
    </>
  );
}

// groups: the chip row under the toolbar
async function Groups({ filters, selecting }: { filters: ReceiptListFilters; selecting: boolean }) {
  return (
    <GroupFilter
      groups={await getWorkspaceGroups()}
      selectedIds={filters.groups ?? []}
      selecting={selecting}
    />
  );
}

export default async function HistoryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const { page: requested, ...raw } = filtersFromSearchParams(params);
  const filters = cleanFilters(raw);
  const selecting = params[SELECT_PARAM] === "1"; // groups
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
      {/* groups */}
      <Suspense fallback={<Skeleton className="mb-5 h-9 w-full" />}>
        <Groups filters={filters} selecting={selecting} />
      </Suspense>
      <Suspense fallback={<RowsSkeleton />} key={`${query}${selecting}`}>
        <Results filters={filters} query={query} selecting={selecting} />
      </Suspense>
    </div>
  );
}
