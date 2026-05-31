import { ReceiptResult } from "@/components/receipt-result";
import { getReceiptForCurrentUser } from "@/lib/receipts";
import { notFound } from "next/navigation";

export default async function ReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const receipt = await getReceiptForCurrentUser(id);
  if (!receipt) notFound();
  return <ReceiptResult receipt={receipt} />;
}
