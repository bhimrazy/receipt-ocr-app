import { SpendSkeleton } from "./spend-skeleton";

export default function SpendingLoading() {
  return (
    <div aria-busy="true" aria-live="polite" className="mx-auto max-w-6xl">
      <span className="sr-only">Loading…</span>
      <SpendSkeleton />
    </div>
  );
}
