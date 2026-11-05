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
import { cleanFilters, filtersFromSearchParams, listReceiptSummaries } from "@/lib/receipts";
import { buttonVariants } from "@receipt-ocr/ui/components/button";
import { Download } from "lucide-react";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "History" };

export default async function HistoryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { page: requested, ...raw } = filtersFromSearchParams(await searchParams);
  const filters = cleanFilters(raw);
  const { rows, total, page, pageSize } = await listReceiptSummaries({
    ...filters,
    page: requested,
  });
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="mx-auto max-w-6xl">
      <ListPoller active={rows.some((receipt) => isInFlight(receipt.status))} />
      <PageHeader>
        <PageHeaderContent>
          <PageHeaderTitle>History</PageHeaderTitle>
          <PageHeaderDescription>
            {total} {total === 1 ? "receipt" : "receipts"} in this workspace
            {totalPages > 1 ? ` · page ${page} of ${totalPages}` : ""}
          </PageHeaderDescription>
        </PageHeaderContent>
        <PageHeaderActions>
          <a className={buttonVariants({ variant: "outline" })} href={exportHref(filters)}>
            <Download aria-hidden="true" />
            {isFiltered(filters) ? "Export filtered CSV" : "Export CSV"}
          </a>
        </PageHeaderActions>
      </PageHeader>
      <HistoryToolbar filters={filters} />
      <HistoryResults filters={filters} page={page} receipts={rows} totalPages={totalPages} />
    </div>
  );
}
