import { PageHeaderSkeleton, PanelSkeleton } from "@/components/app-skeletons";

/** Settings: title, then stacked section cards. */
export default function SettingsLoading() {
  return (
    <div aria-busy="true" aria-live="polite" className="mx-auto max-w-5xl">
      <span className="sr-only">Loading…</span>
      <PageHeaderSkeleton />
      <div className="space-y-6">
        <PanelSkeleton />
        <PanelSkeleton />
        <PanelSkeleton />
      </div>
    </div>
  );
}
