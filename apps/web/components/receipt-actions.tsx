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
import { Copy, Download, MoreHorizontal, Pencil, Trash2, TriangleAlert } from "lucide-react";
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
 * Header actions. Completed: Export CSV, with Copy JSON and Delete in the
 * overflow menu (editing lives on the Details card). Failed or still reading:
 * Delete only, since there is nothing to export yet. Delete needs `canEdit`.
 */
export function ReceiptActions({
  receipt,
  canEdit,
}: {
  receipt: ReceiptWithItems;
  canEdit: boolean;
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
    downloadBlob(
      receiptItemsToCsv(receipt),
      csvFilename("receipt", receipt.merchant),
      "text/csv;charset=utf-8",
    );
  }

  const dialog = (
    <ConfirmDialog
      cancelLabel="Keep receipt"
      confirmLabel="Delete receipt"
      description="The photo, the extracted data and its line items are removed for everyone in this workspace. This can't be undone."
      destructive
      onConfirm={remove}
      onOpenChange={setConfirmOpen}
      open={confirmOpen}
      title={`Delete ${receipt.merchant ? `the ${receipt.merchant} receipt` : "this receipt"}?`}
    />
  );

  if (!completed) {
    if (!canEdit) return null;
    return (
      <>
        <Button onClick={() => setConfirmOpen(true)} variant="outline">
          <Trash2 aria-hidden="true" />
          Delete
        </Button>
        {dialog}
      </>
    );
  }

  return (
    <div className="flex w-full gap-2 md:w-auto">
      <Button className="max-md:flex-1" onClick={exportCsv}>
        <Download aria-hidden="true" />
        Export CSV
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={<Button aria-label="More actions" size="icon" variant="outline" />}
        >
          <MoreHorizontal aria-hidden="true" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuGroup>
            <DropdownMenuItem onClick={copyJson}>
              <Copy aria-hidden="true" />
              Copy JSON
            </DropdownMenuItem>
          </DropdownMenuGroup>
          {canEdit ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuItem onClick={() => setConfirmOpen(true)} variant="destructive">
                  <Trash2 aria-hidden="true" />
                  Delete receipt
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      {dialog}
    </div>
  );
}

/**
 * Owns the edit toggle. Editing swaps the Details card for the form, so the
 * photo stays beside the fields being corrected; the checklist's button opens
 * the same form.
 */
export function ReceiptWorkspace({
  receipt,
  canEdit,
  checks,
  image,
  details,
  items,
  footer,
}: {
  receipt: ReceiptWithItems;
  canEdit: boolean;
  /** Plain-words reasons to check this receipt; empty when there are none. */
  checks: string[];
  image: React.ReactNode;
  details: React.ReactNode;
  items: React.ReactNode;
  footer?: React.ReactNode;
}) {
  const [editing, setEditing] = useState(false);

  function startEditing() {
    setEditing(true);
    // Move focus into the form so keyboard and screen-reader users land on it.
    requestAnimationFrame(() => document.getElementById("merchant")?.focus());
  }

  return (
    <>
      {checks.length > 0 ? (
        <section
          aria-labelledby="checks-heading"
          className="mb-6 flex flex-col gap-3 rounded-lg border border-warning/30 bg-warning/5 p-4 sm:flex-row sm:items-start"
        >
          <TriangleAlert
            aria-hidden="true"
            className="size-5 shrink-0 text-warning max-sm:hidden"
          />
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-medium text-warning" id="checks-heading">
              Check this receipt before you export it
            </h2>
            <ul className="mt-2 flex list-disc flex-col gap-1 pl-4 text-sm text-muted-foreground marker:text-warning">
              {checks.map((check) => (
                <li key={check}>{check}</li>
              ))}
            </ul>
          </div>
          {editing || !canEdit ? null : (
            <Button className="shrink-0" onClick={startEditing} variant="outline">
              <Pencil aria-hidden="true" />
              Correct details
            </Button>
          )}
        </section>
      ) : null}
      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        {image}
        <div className="flex min-w-0 flex-col gap-5">
          {editing && canEdit ? (
            <ReceiptEditor onClose={() => setEditing(false)} receipt={receipt} />
          ) : !canEdit ? (
            details
          ) : (
            <div className="relative">
              {details}
              <Button
                aria-label="Edit details"
                className="absolute top-3 right-3"
                onClick={startEditing}
                size="sm"
                variant="outline"
              >
                <Pencil aria-hidden="true" />
                Edit
              </Button>
            </div>
          )}
          {items}
          {footer}
        </div>
      </div>
    </>
  );
}
