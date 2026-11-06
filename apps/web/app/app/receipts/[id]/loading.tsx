import { PageHeaderSkeleton } from "@/components/app-skeletons";
import { Skeleton } from "@receipt-ocr/ui/components/skeleton";

/** A receipt opening: title, then the photo beside the extracted details. */
export default function ReceiptLoading() {
  return (
    <div aria-busy="true" aria-live="polite" className="mx-auto max-w-6xl">
      <span className="sr-only">Loading…</span>
      <PageHeaderSkeleton />
      <div className="grid gap-6 lg:grid-cols-2">
        <Skeleton className="h-96 w-full rounded-xl" />
        <div className="space-y-3">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      </div>
    </div>
  );
}
