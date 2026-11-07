import { ReceiptGroups } from "@/components/groups/receipt-groups"; // groups
import { ReceiptResult } from "@/components/receipt-result";
import { getReceiptGroups, getWorkspaceGroups } from "@/lib/groups"; // groups
import { canEditReceipt } from "@/lib/receipt-permissions";
import { getReceiptForWorkspace } from "@/lib/receipts";
import { requireActiveScope } from "@/lib/session";
import { notFound } from "next/navigation";
import { logPageRender } from "@/lib/page-event";

export default async function ReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  logPageRender("/app/receipts/[id]");
  const { id } = await params;
  // groups: chips and "Add to group" under the title.
  const [receipt, scope, groups, inGroups] = await Promise.all([
    getReceiptForWorkspace(id),
    requireActiveScope(),
    getWorkspaceGroups(),
    getReceiptGroups(id),
  ]);
  if (!receipt) notFound();
  return (
    <ReceiptResult
      canEdit={canEditReceipt(scope, receipt)}
      groups={<ReceiptGroups groups={groups} inGroups={inGroups} receiptId={receipt.id} />}
      receipt={receipt}
    />
  );
}
