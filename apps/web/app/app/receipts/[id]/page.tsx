import { ReceiptGroups } from "@/components/groups/receipt-groups"; // groups
import { ReceiptResult } from "@/components/receipt-result";
import { getReceiptGroups, getWorkspaceGroups } from "@/lib/groups"; // groups
import { canEditReceipt } from "@/lib/receipt-permissions";
import { getReceiptForWorkspace } from "@/lib/receipts";
import { requireActiveScope } from "@/lib/session";
import { notFound } from "next/navigation";

export default async function ReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [receipt, scope] = await Promise.all([getReceiptForWorkspace(id), requireActiveScope()]);
  if (!receipt) notFound();
  // groups: chips and "Add to group" under the title
  const [groups, inGroups] = await Promise.all([getWorkspaceGroups(), getReceiptGroups(id)]);
  return (
    <ReceiptResult
      canEdit={canEditReceipt(scope, receipt)}
      groups={<ReceiptGroups groups={groups} inGroups={inGroups} receiptId={receipt.id} />}
      receipt={receipt}
    />
  );
}
