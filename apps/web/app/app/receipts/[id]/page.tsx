import { ReceiptGroups } from "@/components/groups/receipt-groups"; // groups
import { ReceiptResult } from "@/components/receipt-result";
import { getReceiptGroups, getWorkspaceGroups } from "@/lib/groups"; // groups
import { canEditReceipt } from "@/lib/receipt-permissions";
import { getReceiptForWorkspace } from "@/lib/receipts";
import { requireActiveScope } from "@/lib/session";
import { notFound } from "next/navigation";

export default async function ReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // groups: chips and "Add to group" under the title. A missing receipt makes its groups lookup fail.
  const [receipt, scope, groups, inGroups] = await Promise.all([
    getReceiptForWorkspace(id),
    requireActiveScope(),
    getWorkspaceGroups(),
    getReceiptGroups(id).catch(() => []),
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
