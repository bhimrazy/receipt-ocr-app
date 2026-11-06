import { Skeleton } from "@receipt-ocr/ui/components/skeleton";
import type { Metadata } from "next";
import { Suspense } from "react";
import {
  PageHeader,
  PageHeaderContent,
  PageHeaderDescription,
  PageHeaderTitle,
} from "@/components/page-header";
import { UploadPanel } from "@/components/upload-panel";
import { formatTimeUntil } from "@/lib/format";
import { getCurrentPlan } from "@/lib/plan-limits";
import { getUsageSummary } from "@/lib/receipts";

export const metadata: Metadata = { title: "Upload" };

type Search = Promise<Record<string, string | string[] | undefined>>;

/**
 * The upload panel on its own, for the home-screen shortcut (`?capture=1` opens the camera)
 * and the share target (`?shared=1`; the shared files land in review). Home has the same panel.
 */
async function Panel({ searchParams }: { searchParams: Search }) {
  const [params, usage, { policy }] = await Promise.all([
    searchParams,
    getUsageSummary(),
    getCurrentPlan(),
  ]);
  return (
    <UploadPanel
      batchMax={policy.batchMax}
      resetsIn={formatTimeUntil(usage.resetsAt)}
      startCamera={params.capture === "1"}
      usage={usage}
    />
  );
}

export default function UploadPage({ searchParams }: { searchParams: Search }) {
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader>
        <PageHeaderContent>
          <PageHeaderTitle>Upload receipts</PageHeaderTitle>
          <PageHeaderDescription>
            Take photos or add files. You can crop and straighten each photo before it uploads.
          </PageHeaderDescription>
        </PageHeaderContent>
      </PageHeader>
      <Suspense fallback={<Skeleton className="h-64 w-full rounded-xl" />}>
        <Panel searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
