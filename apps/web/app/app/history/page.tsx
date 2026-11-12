import { RowsSkeleton } from "@/components/app-skeletons";
// groups: filter chips
import { GroupFilter } from "@/components/groups/group-filter";
import { getWorkspaceGroups } from "@/lib/groups";
import { exportHref, isFiltered } from "@/components/history/history-href";
import { HistoryResults } from "@/components/history/history-results";
import { HistoryToolbar } from "@/components/history/history-toolbar";
import { DEFAULT_PAGE_SIZE, type ListView } from "@/components/history/list-view";
import { PhoneSelectButton, SelectionProvider } from "@/components/history/selection-context";
import {
  PageHeader,
  PageHeaderActions,
  PageHeaderContent,
  PageHeaderDescription,
  PageHeaderTitle,
} from "@/components/page-header";
import { ListPoller } from "@/components/processing-poller";
import { SectionBoundary } from "@/components/section-error";
import { isInFlight } from "@/components/receipt-status";
import {
  cleanFilters,
  filtersFromSearchParams,
  getReceiptCounts,
  listReceiptSummaries,
  type HistoryFilters,
  type ReceiptListFilters,
} from "@/lib/receipts";
import { requireActiveScope } from "@/lib/session";
import { isSharedWorkspace } from "@/lib/workspaces";
import { buttonVariants } from "@receipt-ocr/ui/components/button";
import { Skeleton } from "@receipt-ocr/ui/components/skeleton";
import { Download } from "lucide-react";
import type { Metadata } from "next";
import { unstable_rethrow } from "next/navigation";
import { Suspense, cache } from "react";
import { logPageRender } from "@/lib/page-event";

export const metadata: Metadata = { title: "History" };

// Keyed by a string so the header summary and the results share one query per request.
const loadPage = cache((key: string) =>
  listReceiptSummaries(JSON.parse(key) as ReceiptListFilters),
);

async function Summary({ query }: { query: string }) {
  // Results reports a failed read, with a retry; the header just leaves the count out.
  const loaded = await loadPage(query).catch((error: unknown) => {
    unstable_rethrow(error);
    return null;
  });
  if (!loaded) return null;
  return (
    <>
      {loaded.total} {loaded.total === 1 ? "receipt" : "receipts"} in this workspace
    </>
  );
}

async function Results({
  query,
  filters,
  view,
}: {
  query: string;
  filters: HistoryFilters;
  view: ListView;
}) {
  const scope = await requireActiveScope();
  const [{ rows, total, page }, counts, groups, shared] = await Promise.all([
    loadPage(query),
    getReceiptCounts(),
    getWorkspaceGroups(),
    isSharedWorkspace(scope.organizationId),
  ]);
  return (
    <>
      <ListPoller active={rows.some((receipt) => isInFlight(receipt.status))} counts={counts} />
      <HistoryResults
        filters={filters}
        groups={groups}
        page={page}
        receipts={rows}
        shared={shared}
        total={total}
        view={view}
        viewer={{ userId: scope.userId, role: scope.role }}
      />
    </>
  );
}

// groups: the chip row under the toolbar
async function Groups({ filters }: { filters: HistoryFilters }) {
  return <GroupFilter groups={await getWorkspaceGroups()} selectedIds={filters.groups ?? []} />;
}

export default async function HistoryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  logPageRender("/app/history");
  const params = await searchParams;
  const { page: requested, pageSize, sort, ...raw } = filtersFromSearchParams(params);
  const filters = cleanFilters(raw);
  const view: ListView = { size: pageSize ?? DEFAULT_PAGE_SIZE, sort };
  const query = JSON.stringify({ ...filters, page: requested, pageSize: view.size, sort });

  return (
    <SelectionProvider filterKey={JSON.stringify(filters)}>
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
            <a className={buttonVariants({ variant: "outline" })} href={exportHref(filters, view)}>
              <Download aria-hidden="true" />
              {isFiltered(filters) ? "Export filtered CSV" : "Export CSV"}
            </a>
          </PageHeaderActions>
        </PageHeader>
        <PhoneSelectButton />
        <Suspense fallback={<Skeleton className="h-11 w-full" />}>
          <HistoryToolbar filters={filters} />
        </Suspense>
        {/* groups */}
        <SectionBoundary className="mb-5" label="Groups">
          <Suspense fallback={<Skeleton className="mb-5 h-9 w-full" />}>
            <Groups filters={filters} />
          </Suspense>
        </SectionBoundary>
        <SectionBoundary key={query} label="Receipts">
          <Suspense fallback={<RowsSkeleton />}>
            <Results filters={filters} query={query} view={view} />
          </Suspense>
        </SectionBoundary>
      </div>
    </SelectionProvider>
  );
}
