import { ReceiptResult } from "@/components/receipt-result";
import { canEditReceipt } from "@/lib/receipt-permissions";
import { getReceiptForWorkspace } from "@/lib/receipts";
import { requireActiveScope } from "@/lib/session";
import { notFound } from "next/navigation";

export default async function ReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [receipt, scope] = await Promise.all([getReceiptForWorkspace(id), requireActiveScope()]);
  if (!receipt) notFound();
  return <ReceiptResult canEdit={canEditReceipt(scope, receipt)} receipt={receipt} />;
}
