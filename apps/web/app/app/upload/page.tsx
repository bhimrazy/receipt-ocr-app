import { Skeleton } from "@receipt-ocr/ui/components/skeleton";
import type { Metadata } from "next";
import { Suspense } from "react";
import {
  PageHeader,
  PageHeaderContent,
  PageHeaderDescription,
  PageHeaderTitle,
} from "@/components/page-header";
import { SectionBoundary } from "@/components/section-error";
import { UploadPanel } from "@/components/upload-panel";
import { formatTimeUntil } from "@/lib/format";
import { getCurrentPlan, getPlanTable } from "@/lib/plan-limits";
import { getUsageSummary } from "@/lib/receipts";
import { getUpgradeOffer } from "@/lib/upgrade-offer";

export const metadata: Metadata = { title: "Add receipts" };

/**
 * The upload panel on its own, for the Scan tab and home-screen shortcut (`?capture=1` opens
 * the camera; the panel reads it from the URL) and the share target (`?shared=1`; the shared
 * files land in review). Home has the same panel.
 */
async function Panel() {
  const [usage, { plan, policy }, offer, plans] = await Promise.all([
    getUsageSummary(),
    getCurrentPlan(),
    getUpgradeOffer(),
    getPlanTable(),
  ]);
  return (
    <UploadPanel
      batchMax={policy.batchMax}
      plan={{ pro: plan === "free" ? plans.pro : null, offer: offer?.audience ?? null }}
      resetsIn={formatTimeUntil(usage.opensAt)}
      usage={usage}
    />
  );
}

export default function UploadPage() {
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader>
        <PageHeaderContent>
          <PageHeaderTitle>Add receipts</PageHeaderTitle>
          <PageHeaderDescription>
            Take photos or add files. You can crop and straighten each photo before it uploads.
          </PageHeaderDescription>
        </PageHeaderContent>
      </PageHeader>
      <SectionBoundary label="Upload">
        <Suspense fallback={<Skeleton className="h-64 w-full rounded-xl" />}>
          <Panel />
        </Suspense>
      </SectionBoundary>
    </div>
  );
}
