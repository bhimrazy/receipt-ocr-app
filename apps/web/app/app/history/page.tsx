import { HistoryTable, type HistoryFilters } from "@/components/history-table";
import type { Metadata } from "next";
import { listReceiptSummaries } from "../_data/receipts-contract";

export const metadata: Metadata = { title: "History" };

type Params = {
  page?: string;
  q?: string;
  category?: string;
  status?: string;
  from?: string;
  to?: string;
};

const STATUSES = ["needs-review", "failed", "processing", "completed", "uploaded"] as const;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function parseFilters(params: Params): HistoryFilters {
  const status = STATUSES.find((value) => value === params.status);
  return {
    q: params.q?.trim() || undefined,
    category: params.category || undefined,
    status,
    from: params.from && ISO_DATE.test(params.from) ? params.from : undefined,
    to: params.to && ISO_DATE.test(params.to) ? params.to : undefined,
  };
}

export default async function HistoryPage({ searchParams }: { searchParams: Promise<Params> }) {
  const params = await searchParams;
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);
  const filters = parseFilters(params);
  const { rows, total, pageSize } = await listReceiptSummaries({ ...filters, page });
  return (
    <HistoryTable filters={filters} page={page} pageSize={pageSize} receipts={rows} total={total} />
  );
}
