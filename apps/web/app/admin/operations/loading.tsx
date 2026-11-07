import { Skeleton } from "@receipt-ocr/ui/components/skeleton";

/** Placeholder while the metrics load: header, range switcher, KPI tiles and four charts. */
export default function OperationsLoading() {
  return (
    <div aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading operations…</span>
      <Skeleton className="h-9 w-48" />
      <Skeleton className="mt-3 h-4 w-full max-w-lg" />
      <Skeleton className="mt-4 h-11 w-full max-w-md" />
      <div className="mt-8 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton className="h-24" key={i} />
        ))}
      </div>
      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton className="h-80" key={i} />
        ))}
      </div>
    </div>
  );
}
