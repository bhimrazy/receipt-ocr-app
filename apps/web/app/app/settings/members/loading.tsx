import { PageHeaderSkeleton, RowsSkeleton } from "@/components/app-skeletons";

/** Members: title and the member list. */
export default function MembersLoading() {
  return (
    <div aria-busy="true" aria-live="polite" className="mx-auto max-w-3xl">
      <span className="sr-only">Loading…</span>
      <PageHeaderSkeleton />
      <RowsSkeleton rows={4} />
    </div>
  );
}
