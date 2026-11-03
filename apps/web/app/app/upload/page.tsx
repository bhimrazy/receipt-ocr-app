import { UploadPanel } from "@/components/upload-panel";
import type { Metadata } from "next";
import { getUsageSummary } from "../_data/receipts-contract";

export const metadata: Metadata = { title: "Upload" };

export default async function UploadPage() {
  const usage = await getUsageSummary().catch(() => null);
  return (
    <UploadPanel
      limit={usage?.limit ?? null}
      remaining={usage ? Math.max(0, usage.limit - usage.used) : null}
    />
  );
}
