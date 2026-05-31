import { HistoryTable } from "@/components/history-table";
import { listReceiptsForCurrentUser } from "@/lib/receipts";

export default async function HistoryPage() {
  const receipts = await listReceiptsForCurrentUser();
  return <HistoryTable receipts={receipts} />;
}
