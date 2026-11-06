import { Card } from "@receipt-ocr/ui/components/card";
import { Skeleton } from "@receipt-ocr/ui/components/skeleton";

/** Placeholder for a PageHeader: title and one line of description. */
export function PageHeaderSkeleton() {
  return (
    <div className="mb-6">
      <Skeleton className="h-8 w-56 md:h-9" />
      <Skeleton className="mt-3 h-4 w-full max-w-md" />
    </div>
  );
}

/** Placeholder for a list of receipt rows inside a card. */
export function RowsSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <Card className="overflow-hidden">
      <div className="divide-y divide-border">
        {Array.from({ length: rows }, (_, i) => (
          <div className="flex items-center gap-3 px-4 py-4" key={i}>
            <Skeleton className="size-9 rounded-full" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-1/3" />
              <Skeleton className="h-3 w-1/2" />
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

/** Placeholder for a side card such as "To check". */
export function PanelSkeleton({ className }: { className?: string }) {
  return (
    <Card className={className}>
      <div className="space-y-3 p-4">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
      </div>
    </Card>
  );
}
