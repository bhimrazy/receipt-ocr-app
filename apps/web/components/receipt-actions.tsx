"use client";

import type { ReceiptWithItems } from "@receipt-ocr/core";
import { Button } from "@receipt-ocr/ui/components/button";
import { ConfirmDialog } from "@receipt-ocr/ui/components/confirm-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@receipt-ocr/ui/components/dropdown-menu";
import { toast } from "@receipt-ocr/ui/components/toast";
import { Copy, Download, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { csvFilename, receiptItemsToCsv } from "@/lib/csv";
import { ReceiptEditor } from "@/components/receipt-editor";

function downloadBlob(contents: string, filename: string, type: string) {
  const url = URL.createObjectURL(new Blob([contents], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function useDeleteReceipt(receipt: ReceiptWithItems) {
  const router = useRouter();
  return async (): Promise<string | void> => {
    const res = await fetch(`/api/receipts/${receipt.id}`, { method: "DELETE" });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      return body?.error ?? "Couldn't delete this receipt. Try again.";
    }
    toast.add({ title: "Receipt deleted", type: "success" });
    router.push("/app/history");
    router.refresh();
  };
}

/**
 * Actions per state. Completed: Edit and Export CSV, with Copy JSON and
 * Delete in the overflow menu. Failed or still reading: Delete only (retry
 * lives in the failure banner), since there is nothing to export yet.
 */
export function ReceiptActions({
  receipt,
  editing = false,
  onEdit,
}: {
  receipt: ReceiptWithItems;
  editing?: boolean;
  onEdit?: () => void;
}) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const remove = useDeleteReceipt(receipt);
  const completed = receipt.status === "completed";

  async function copyJson() {
    try {
      await navigator.clipboard.writeText(JSON.stringify(receipt.rawJson ?? receipt, null, 2));
      toast.add({ title: "JSON copied", type: "success" });
    } catch {
      toast.add({ title: "Couldn't copy to the clipboard", type: "error" });
    }
  }

  function exportCsv() {
    downloadBlob(receiptItemsToCsv(receipt), csvFilename("receipt", receipt.merchant), "text/csv;charset=utf-8");
  }

  const dialog = (
    <ConfirmDialog
      cancelLabel="Keep receipt"
      confirmLabel="Delete receipt"
      description="The image, the extracted data and its line items are removed for everyone in this workspace. This can't be undone."
      destructive
      onConfirm={remove}
      onOpenChange={setConfirmOpen}
      open={confirmOpen}
      title={`Delete ${receipt.merchant ? `the ${receipt.merchant} receipt` : "this receipt"}?`}
    />
  );

  if (!completed) {
    return (
      <>
        <Button className="max-md:w-full" onClick={() => setConfirmOpen(true)} variant="outline">
          <Trash2 aria-hidden="true" />
          Delete
        </Button>
        {dialog}
      </>
    );
  }

  return (
    <div className="flex w-full gap-2 md:w-auto">
      {onEdit ? (
        <Button aria-pressed={editing} className="max-md:hidden" onClick={onEdit} variant="outline">
          <Pencil aria-hidden="true" />
          {editing ? "Editing" : "Edit"}
        </Button>
      ) : null}
      <Button className="max-md:flex-1" onClick={exportCsv}>
        <Download aria-hidden="true" />
        Export CSV
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button aria-label="More actions" size="icon" variant="outline" />}>
          <MoreHorizontal aria-hidden="true" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuGroup>
            {onEdit ? (
              <DropdownMenuItem className="md:hidden" onClick={onEdit}>
                <Pencil aria-hidden="true" />
                {editing ? "Stop editing" : "Edit"}
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuItem onClick={copyJson}>
              <Copy aria-hidden="true" />
              Copy JSON
            </DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuItem onClick={() => setConfirmOpen(true)} variant="destructive">
              <Trash2 aria-hidden="true" />
              Delete receipt
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      {dialog}
    </div>
  );
}

/**
 * Owns the edit toggle. Editing swaps the extracted-data card for the form,
 * so the receipt image stays beside the fields being corrected.
 */
export function ReceiptWorkspace({
  receipt,
  header,
  image,
  extracted,
}: {
  receipt: ReceiptWithItems;
  header: React.ReactNode;
  image: React.ReactNode;
  extracted: React.ReactNode;
}) {
  const [editing, setEditing] = useState(false);

  return (
    <>
      <div className="mb-6 flex flex-col justify-between gap-4 md:flex-row md:items-start">
        {header}
        <ReceiptActions editing={editing} onEdit={() => setEditing((value) => !value)} receipt={receipt} />
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        {image}
        {editing ? <ReceiptEditor onClose={() => setEditing(false)} receipt={receipt} /> : extracted}
      </div>
    </>
  );
}
