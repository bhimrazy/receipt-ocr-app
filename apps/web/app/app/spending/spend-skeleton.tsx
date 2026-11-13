import { PageHeaderSkeleton } from "@/components/app-skeletons";
import { Skeleton } from "@receipt-ocr/ui/components/skeleton";
import { cn } from "@receipt-ocr/ui/lib/utils";

export function SpendSkeleton() {
  return (
    <div aria-hidden="true" className="flex flex-col gap-4">
      <PageHeaderSkeleton />
      <Skeleton className="h-9 w-full max-w-lg rounded-full" />
      <Skeleton className="h-72 w-full rounded-lg" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton
            className={cn("h-28 rounded-lg", i === 0 && "col-span-2 lg:col-span-1")}
            key={i}
          />
        ))}
      </div>
    </div>
  );
}
