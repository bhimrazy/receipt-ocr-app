import { PageHeaderSkeleton, RowsSkeleton } from "@/components/app-skeletons";
import { Skeleton } from "@receipt-ocr/ui/components/skeleton";

/** Receipts: title, search, filters, then the receipt list. */
export default function ReceiptsLoading() {
  return (
    <div aria-busy="true" aria-live="polite" className="mx-auto max-w-6xl">
      <span className="sr-only">Loading…</span>
      <PageHeaderSkeleton />
      <Skeleton className="h-11 w-full" />
      <Skeleton className="my-5 h-9 w-full" />
      <RowsSkeleton rows={8} />
    </div>
  );
}
