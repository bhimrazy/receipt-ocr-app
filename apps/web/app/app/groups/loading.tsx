import { PageHeaderSkeleton, RowsSkeleton } from "@/components/app-skeletons";

/** Groups: title and the list of groups. */
export default function GroupsLoading() {
  return (
    <div aria-busy="true" aria-live="polite" className="mx-auto max-w-3xl">
      <span className="sr-only">Loading…</span>
      <PageHeaderSkeleton />
      <RowsSkeleton rows={4} />
    </div>
  );
}
