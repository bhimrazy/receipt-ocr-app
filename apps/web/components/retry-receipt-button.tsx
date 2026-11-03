"use client";

import { Button, type ButtonProps } from "@receipt-ocr/ui/components/button";
import { toast } from "@receipt-ocr/ui/components/toast";
import { Loader2, RotateCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

/** Re-runs extraction on the stored image (POST /api/receipts/<id>/retry). */
export function RetryReceiptButton({
  receiptId,
  label = "Try again",
  ...props
}: { receiptId: string; label?: string } & Omit<ButtonProps, "onClick" | "children">) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function retry() {
    setPending(true);
    try {
      const res = await fetch(`/api/receipts/${receiptId}/retry`, { method: "POST" });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        toast.add({ title: "Couldn't retry", description: body?.error ?? "Try again in a moment.", type: "error" });
        return;
      }
      router.refresh();
    } catch {
      toast.add({ title: "Couldn't retry", description: "Check your connection and try again.", type: "error" });
    } finally {
      setPending(false);
    }
  }

  return (
    <Button disabled={pending} onClick={retry} {...props}>
      {pending ? <Loader2 aria-hidden="true" className="animate-spin" /> : <RotateCw aria-hidden="true" />}
      {label}
    </Button>
  );
}
