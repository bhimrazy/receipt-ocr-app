"use client";

import type { ReceiptWithItems } from "@receipt-ocr/core";
import { Button } from "@receipt-ocr/ui/components/button";
import { Check, Copy, Download, Loader2, Pencil, Trash2 } from "lucide-react";
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

/**
 * Copy / export / delete for a single receipt. These three buttons existed as
 * static markup with no handlers; the export in particular is the outcome the
 * whole product promises, so it had to actually produce a file.
 */
export function ReceiptActions({
  receipt,
  onEdit,
  editing,
}: {
  receipt: ReceiptWithItems;
  onEdit: () => void;
  editing: boolean;
}) {
  const router = useRouter();
  const [copied, setCopied] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function copyJson() {
    const json = JSON.stringify(receipt.rawJson ?? receipt, null, 2);
    try {
      await navigator.clipboard.writeText(json);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Couldn't copy to the clipboard.");
    }
  }

  function exportCsv() {
    downloadBlob(
      receiptItemsToCsv(receipt),
      csvFilename("receipt", receipt.merchant),
      "text/csv;charset=utf-8",
    );
  }

  async function remove() {
    setDeleting(true);
    setError(null);
    const res = await fetch(`/api/receipts/${receipt.id}`, { method: "DELETE" });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      setError(body?.error ?? "Couldn't delete this receipt.");
      setDeleting(false);
      setConfirmingDelete(false);
      return;
    }
    router.push("/app/history");
    router.refresh();
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex flex-wrap justify-end gap-2">
        <Button onClick={onEdit} variant={editing ? "default" : "outline"}>
          <Pencil className="size-4" />
          {editing ? "Editing" : "Edit"}
        </Button>
        <Button onClick={copyJson} variant="outline">
          {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
          {copied ? "Copied" : "Copy JSON"}
        </Button>
        <Button onClick={exportCsv}>
          <Download className="size-4" />
          Export CSV
        </Button>
        <Button
          aria-label="Delete receipt"
          disabled={deleting}
          onClick={() => setConfirmingDelete(true)}
          variant="outline"
        >
          <Trash2 className="size-4" />
        </Button>
      </div>

      {confirmingDelete ? (
        <div
          className="w-full max-w-sm rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm"
          role="alertdialog"
        >
          <p className="font-medium text-red-200">Delete this receipt?</p>
          <p className="mt-1 text-xs text-red-200/80">
            The extracted data and line items are removed permanently. This can&apos;t be undone.
          </p>
          <div className="mt-3 flex gap-2">
            <Button disabled={deleting} onClick={remove} size="sm" variant="destructive">
              {deleting ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Trash2 className="size-4" />
              )}
              Delete
            </Button>
            <Button
              disabled={deleting}
              onClick={() => setConfirmingDelete(false)}
              size="sm"
              variant="outline"
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : null}

      {error ? (
        <p className="text-xs text-red-400" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Owns the edit toggle so the server-rendered header stays a server component:
 * the (static) title block is passed through as children and the interactive
 * pieces live here.
 */
export function ReceiptToolbar({
  receipt,
  children,
}: {
  receipt: ReceiptWithItems;
  children: React.ReactNode;
}) {
  const [editing, setEditing] = useState(false);

  return (
    <>
      <div className="mb-6 flex flex-col justify-between gap-4 md:flex-row md:items-start">
        {children}
        <ReceiptActions
          editing={editing}
          onEdit={() => setEditing((value) => !value)}
          receipt={receipt}
        />
      </div>
      {editing ? <ReceiptEditor onClose={() => setEditing(false)} receipt={receipt} /> : null}
    </>
  );
}
