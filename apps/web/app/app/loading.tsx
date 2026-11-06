import { PageHeaderSkeleton, PanelSkeleton, RowsSkeleton } from "@/components/app-skeletons";
import { Skeleton } from "@receipt-ocr/ui/components/skeleton";

/** Shown inside the app shell while a /app page loads. */
export default function AppLoading() {
  return (
    <div aria-busy="true" aria-live="polite" className="mx-auto max-w-6xl">
      <span className="sr-only">Loading…</span>
      <PageHeaderSkeleton />
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <Skeleton className="h-64 w-full rounded-xl" />
        <PanelSkeleton />
      </div>
      <div className="mt-10">
        <RowsSkeleton rows={4} />
      </div>
    </div>
  );
}
