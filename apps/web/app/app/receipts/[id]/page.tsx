import { ReceiptGroups } from "@/components/groups/receipt-groups"; // groups
import { ReceiptResult } from "@/components/receipt-result";
import { getReceiptGroups, getWorkspaceGroups } from "@/lib/groups"; // groups
import { canEditReceipt } from "@/lib/receipt-permissions";
import { getReceiptForWorkspace } from "@/lib/receipts";
import { requireActiveScope, requireSession } from "@/lib/session";
import { viewerTimeZone } from "@/lib/spend";
import { TIME_ZONE_COOKIE } from "@/lib/time-zone-cookie";
import { isSharedWorkspace } from "@/lib/workspaces";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { logPageRender } from "@/lib/page-event";

export default async function ReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  logPageRender("/app/receipts/[id]");
  const { id } = await params;
  // groups: chips and "Add to group" under the title.
  const [receipt, scope, session, groups, inGroups, jar, shared] = await Promise.all([
    getReceiptForWorkspace(id),
    requireActiveScope(),
    requireSession(),
    getWorkspaceGroups(),
    getReceiptGroups(id),
    cookies(),
    requireActiveScope().then((scope) => isSharedWorkspace(scope.organizationId)),
  ]);
  if (!receipt) notFound();
  return (
    <ReceiptResult
      canEdit={canEditReceipt(scope, receipt)}
      groups={<ReceiptGroups groups={groups} inGroups={inGroups} receiptId={receipt.id} />}
      receipt={receipt}
      shared={shared}
      timeZone={viewerTimeZone(jar.get(TIME_ZONE_COOKIE)?.value)}
      viewerName={session.user.name}
    />
  );
}
