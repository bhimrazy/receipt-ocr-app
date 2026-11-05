import { Skeleton } from "@receipt-ocr/ui/components/skeleton";

/** Placeholder while an admin page loads: a title, a filter row and a list. */
export default function AdminLoading() {
  return (
    <div aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading…</span>
      <Skeleton className="h-9 w-48" />
      <Skeleton className="mt-3 h-4 w-full max-w-md" />
      <Skeleton className="mt-8 h-11 w-full max-w-xl" />
      <div className="mt-4 divide-y divide-border rounded-lg border border-border">
        {Array.from({ length: 6 }, (_, i) => (
          <div className="flex items-center gap-3 px-4 py-4" key={i}>
            <Skeleton className="size-9 rounded-full" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-1/3" />
              <Skeleton className="h-3 w-1/2" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
