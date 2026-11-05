import { HistoryTable } from "@/components/history-table";
import { cleanFilters, filtersFromSearchParams, listReceiptSummaries } from "@/lib/receipts";
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
  return (
    <HistoryTable filters={filters} page={page} pageSize={pageSize} receipts={rows} total={total} />
  );
}
