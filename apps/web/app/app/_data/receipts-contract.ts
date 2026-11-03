/**
 * TEMPORARY ADAPTER for the receipts data contract that the backend track is
 * adding to `@/lib/receipts`. Once that lands, replace this whole file with:
 *
 *   export {
 *     listReceiptSummaries,
 *     getUsageSummary,
 *     type ReceiptSummary,
 *     type ReceiptFilters,
 *   } from "@/lib/receipts";
 *
 * Until then it maps the current page-only query onto the contract, so
 * search and filters here still only narrow the current page.
 */
import { planPolicy } from "@/lib/plans";
import { checkUploadQuota } from "@/lib/quota";
import { HISTORY_PAGE_SIZE, listReceiptsForWorkspace } from "@/lib/receipts";
import { getSession, planFor } from "@/lib/session";

export type ReceiptSummary = {
  id: string;
  status: "uploaded" | "processing" | "completed" | "failed";
  merchant: string | null;
  receiptDate: string | null;
  category: string | null;
  currency: string;
  total: string | null;
  confidence: number | null;
  fileName: string | null;
  errorMessage: string | null;
  createdAt: Date;
};

export type ReceiptFilters = {
  q?: string;
  category?: string;
  status?: ReceiptSummary["status"] | "needs-review";
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
};

export async function listReceiptSummaries(
  filters: ReceiptFilters,
): Promise<{ rows: ReceiptSummary[]; total: number; page: number; pageSize: number }> {
  const page = filters.page ?? 1;
  const { receipts, total } = await listReceiptsForWorkspace(page);
  const q = filters.q?.toLowerCase();
  const rows = receipts
    .map(
      (receipt): ReceiptSummary => ({
        id: receipt.id,
        status: receipt.status,
        merchant: receipt.merchant,
        receiptDate: receipt.receiptDate,
        category: receipt.category,
        currency: receipt.currency ?? "USD",
        total: receipt.total,
        confidence: receipt.confidence === null ? null : Number(receipt.confidence),
        fileName: (receipt.rawJson as { fileName?: string } | null)?.fileName ?? null,
        errorMessage: receipt.errorMessage,
        createdAt: receipt.createdAt,
      }),
    )
    .filter((row) => !q || (row.merchant ?? row.fileName ?? "").toLowerCase().includes(q))
    .filter((row) => !filters.category || row.category?.toLowerCase() === filters.category.toLowerCase())
    .filter((row) =>
      !filters.status
        ? true
        : filters.status === "needs-review"
          ? row.status === "completed" && row.confidence !== null && row.confidence < 0.9
          : row.status === filters.status,
    )
    .filter((row) => !filters.from || (row.receiptDate ?? "") >= filters.from)
    .filter((row) => !filters.to || (row.receiptDate ?? "") <= filters.to);
  return { rows, total, page, pageSize: HISTORY_PAGE_SIZE };
}

export async function getUsageSummary(): Promise<{ used: number; limit: number; window: "day"; resetsAt: Date }> {
  const session = await getSession();
  if (!session) throw new Error("No session");
  const plan = planFor(session);
  const verdict = await checkUploadQuota(session.user.id, plan);
  // Approximate: the current quota is a rolling 24h window, and a burst stop
  // reports the per-minute count. The backend contract owns the real values.
  const resetsAt = new Date();
  resetsAt.setUTCHours(24, 0, 0, 0);
  return { used: verdict.used, limit: planPolicy(plan).receiptsPerDay, window: "day", resetsAt };
}
