import { HistoryTable } from "@/components/history-table";
import { HISTORY_PAGE_SIZE, listReceiptsForWorkspace } from "@/lib/receipts";

export default async function HistoryPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const { page: pageParam } = await searchParams;
  const page = Math.max(1, Number.parseInt(pageParam ?? "1", 10) || 1);
  const { receipts, total } = await listReceiptsForWorkspace(page);
  return <HistoryTable page={page} pageSize={HISTORY_PAGE_SIZE} receipts={receipts} total={total} />;
}
