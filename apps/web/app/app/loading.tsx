import { PageHeaderSkeleton, RowsSkeleton } from "@/components/app-skeletons";

/** Shown inside the app shell while any /app page loads; page-specific shapes live in their own loading.tsx. */
export default function AppLoading() {
  return (
    <div aria-busy="true" aria-live="polite" className="mx-auto max-w-6xl">
      <span className="sr-only">Loading…</span>
      <PageHeaderSkeleton />
      <RowsSkeleton rows={5} />
    </div>
  );
}
