import { PageHeaderSkeleton } from "@/components/app-skeletons";
import { Skeleton } from "@receipt-ocr/ui/components/skeleton";

/** Upload: title and the drop zone. */
export default function UploadLoading() {
  return (
    <div aria-busy="true" aria-live="polite" className="mx-auto max-w-3xl">
      <span className="sr-only">Loading…</span>
      <PageHeaderSkeleton />
      <Skeleton className="h-64 w-full rounded-xl" />
    </div>
  );
}
