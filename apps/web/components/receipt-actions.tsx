"use client";

import type { ReceiptWithItems } from "@receipt-ocr/core";
import { Button } from "@receipt-ocr/ui/components/button";
import { ConfirmDialog } from "@receipt-ocr/ui/components/confirm-dialog";
import {
  Drawer,
  DrawerAction,
  DrawerContent,
  DrawerDescription,
  DrawerGroup,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@receipt-ocr/ui/components/drawer";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@receipt-ocr/ui/components/dropdown-menu";
import { toast } from "@receipt-ocr/ui/components/toast";
import {
  Copy,
  Download,
  Loader2,
  MoreHorizontal,
  Pencil,
  RotateCw,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { createContext, useContext, useRef, useState } from "react";
import { csvFilename, receiptItemsToCsv } from "@/lib/csv";
import { ReceiptEditor } from "@/components/receipt-editor";
import { useRetryReceipt } from "@/components/retry-receipt-button";
import { AppBarActions } from "@/components/app-nav";

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

type Editing = { editing: boolean; startEditing: (focus?: boolean) => void; stop: () => void };

const EditingContext = createContext<Editing | null>(null);

/**
 * Edit state shared by the header actions (the phone sheet's "Edit details") and the
 * Details card, which sit in different parts of the page.
 */
export function ReceiptEditingProvider({ children }: { children: React.ReactNode }) {
  const [editing, setEditing] = useState(false);
  const value: Editing = {
    editing,
    startEditing(focus = true) {
      setEditing(true);
      // Move focus into the form so keyboard and screen-reader users land on it.
      if (focus) requestAnimationFrame(() => document.getElementById("merchant")?.focus());
    },
    stop: () => setEditing(false),
  };
  return <EditingContext.Provider value={value}>{children}</EditingContext.Provider>;
}

function useEditing() {
  const value = useContext(EditingContext);
  if (!value) throw new Error("useEditing needs ReceiptEditingProvider");
  return value;
}

/**
 * Header actions. Desktop: Export CSV, with Copy JSON and Delete in the overflow menu
 * (editing lives on the Details card); failed or still reading: Delete only. Phones get the
 * same choices plus Edit and Try again in a bottom sheet. Edit and Delete need `canEdit`.
 */
export function ReceiptActions({
  receipt,
  canEdit,
  canRetry = false,
}: {
  receipt: ReceiptWithItems;
  canEdit: boolean;
  /** Failed with tries left. */
  canRetry?: boolean;
}) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const remove = useDeleteReceipt(receipt);
  const { retry, pending: retrying } = useRetryReceipt(receipt.id);
  const editing = useContext(EditingContext);
  // Set by "Edit details", so closing the sheet focuses the form instead of the trigger.
  const focusForm = useRef(false);
  // Set by "Delete receipt": the confirm opens once the sheet has returned focus to its trigger,
  // so the dialog remembers a real element and Cancel (not <body>) gets focus.
  const confirmAfterSheet = useRef(false);
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

  /** Runs a sheet row's action after closing the sheet. */
  const fromSheet = (action: () => void) => () => {
    setSheetOpen(false);
    action();
  };

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

  const canEditDetails = completed && canEdit && editing !== null && !editing.editing;
  const hasSheetRows = completed || canEdit || canRetry;

  // In the app bar, so it stays in reach while the receipt scrolls.
  const sheet = hasSheetRows ? (
    <Drawer onOpenChange={setSheetOpen} open={sheetOpen}>
      <AppBarActions>
        <DrawerTrigger render={<Button aria-label="Receipt actions" size="icon" variant="ghost" />}>
          <MoreHorizontal aria-hidden="true" className="size-5" />
        </DrawerTrigger>
      </AppBarActions>
      <DrawerContent
        finalFocus={() => {
          if (confirmAfterSheet.current) {
            confirmAfterSheet.current = false;
            setTimeout(() => setConfirmOpen(true), 0);
            return true;
          }
          if (!focusForm.current) return true;
          focusForm.current = false;
          return document.getElementById("merchant") ?? true;
        }}
      >
        <DrawerHeader>
          <DrawerTitle className="truncate">{receipt.merchant ?? "This receipt"}</DrawerTitle>
          <DrawerDescription className="sr-only">
            Choose what to do with this receipt.
          </DrawerDescription>
        </DrawerHeader>
        <DrawerGroup>
          {canEditDetails ? (
            <DrawerAction
              onClick={() => {
                setSheetOpen(false);
                focusForm.current = true;
                editing.startEditing(false);
              }}
            >
              <Pencil aria-hidden="true" />
              Edit details
            </DrawerAction>
          ) : null}
          {canRetry ? (
            <DrawerAction disabled={retrying} onClick={fromSheet(() => void retry())}>
              {retrying ? (
                <Loader2 aria-hidden="true" className="animate-spin motion-reduce:animate-none" />
              ) : (
                <RotateCw aria-hidden="true" />
              )}
              Try again
            </DrawerAction>
          ) : null}
          {completed ? (
            <>
              <DrawerAction onClick={fromSheet(exportCsv)}>
                <Download aria-hidden="true" />
                Export CSV
              </DrawerAction>
              <DrawerAction onClick={fromSheet(() => void copyJson())}>
                <Copy aria-hidden="true" />
                Copy JSON
              </DrawerAction>
            </>
          ) : null}
        </DrawerGroup>
        {canEdit ? (
          <DrawerGroup>
            <DrawerAction
              destructive
              onClick={() => {
                confirmAfterSheet.current = true;
                setSheetOpen(false);
              }}
            >
              <Trash2 aria-hidden="true" />
              Delete receipt
            </DrawerAction>
          </DrawerGroup>
        ) : null}
      </DrawerContent>
    </Drawer>
  ) : null;

  if (!completed) {
    if (!canEdit && !canRetry) return null;
    return (
      <>
        {canEdit ? (
          <Button className="max-md:hidden" onClick={() => setConfirmOpen(true)} variant="outline">
            <Trash2 aria-hidden="true" />
            Delete
          </Button>
        ) : null}
        {sheet}
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
      {sheet}
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              aria-label="More actions"
              className="max-md:hidden"
              size="icon"
              variant="outline"
            />
          }
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
 * Editing swaps the Details card for the form, so the photo stays beside the fields being
 * corrected; the checklist's button and the phone sheet open the same form.
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
  const { editing, startEditing, stop } = useEditing();

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
            <Button className="shrink-0" onClick={() => startEditing()} variant="outline">
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
            <ReceiptEditor onClose={stop} receipt={receipt} />
          ) : !canEdit ? (
            details
          ) : (
            <div className="relative">
              {details}
              <Button
                aria-label="Edit details"
                className="absolute top-3 right-3"
                onClick={() => startEditing()}
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
