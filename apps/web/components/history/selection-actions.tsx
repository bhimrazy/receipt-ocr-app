"use client";

import {
  MAX_GROUPS_PER_RECEIPT,
  MAX_RECEIPTS_PER_CALL,
  type MembershipChange,
  type ReceiptGroupRef,
} from "@receipt-ocr/core/group-rules";
import { Button } from "@receipt-ocr/ui/components/button";
import { ConfirmDialog } from "@receipt-ocr/ui/components/confirm-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@receipt-ocr/ui/components/dialog";
import { toast } from "@receipt-ocr/ui/components/toast";
import { cn } from "@receipt-ocr/ui/lib/utils";
import { Download, FolderPlus, Trash2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { addReceiptsRequest, createGroupRequest } from "@/components/groups/api";
import { nextGroupColor } from "@/components/groups/group-colors";
import { GroupPicker } from "@/components/groups/group-picker";
import type { HistoryFilters } from "@/lib/receipts";
import { deleteRequest, exportSelection, matchingIdsRequest } from "./api";
import { exportHref } from "./history-href";
import type { ListView } from "./list-view";
import { NOTHING, receiptCount, selectedCount, type Selection } from "./selection";
import { useSelection } from "./selection-context";

/** What a dialog acts on: the selection, or one row from its menu. */
export type PendingAction = {
  action: "delete" | "group";
  target: Selection;
  source: "selection" | "row";
} | null;

/** After a delete, the selection without what was deleted; "all that match" no longer holds. */
function withoutDeleted(current: Selection, target: Selection): Selection {
  if (target.kind === "all" || current.kind === "all") return NOTHING;
  const ids = new Set(current.ids);
  for (const id of target.ids) ids.delete(id);
  return { kind: "ids", ids };
}

const sentence = (parts: (string | null | false)[]) => {
  const kept = parts.filter(Boolean);
  return kept.length ? `${kept.join(". ")}.` : undefined;
};

/**
 * The delete confirmation and the group picker, for the selection or a single row. Deleting
 * is permanent (there is no "Recently deleted"), so the dialog says so.
 */
export function SelectionDialogs({
  pending,
  onClose,
  filters,
  groups: initialGroups,
  canDeleteAny,
}: {
  pending: PendingAction;
  onClose: () => void;
  filters: HistoryFilters;
  groups: ReceiptGroupRef[];
  /** Owner or admin: may delete anyone's uploads. */
  canDeleteAny: boolean;
}) {
  const router = useRouter();
  const { setSelection, organizationId } = useSelection();
  const [groups, setGroups] = useState(initialGroups);
  const [busyId, setBusyId] = useState<string | null>(null);
  // Keeps the title and count while a dialog animates closed.
  const [shown, setShown] = useState(pending);
  if (pending && pending !== shown) setShown(pending);
  const target = (pending ?? shown)?.target ?? NOTHING;
  const fromSelection = (pending ?? shown)?.source === "selection";
  const n = selectedCount(target);

  async function remove(): Promise<string | void> {
    const result = await deleteRequest(organizationId, target, filters);
    if (!result.ok) return result.error;
    const { deleted, skipped, notFound } = result.data;
    toast.add({
      title: deleted > 0 ? `Deleted ${receiptCount(deleted)}` : "Nothing was deleted",
      description: sentence([
        skipped > 0 &&
          `${receiptCount(skipped)} skipped: only the person who uploaded a receipt, or a workspace owner or admin, can delete it`,
        notFound > 0 && `${receiptCount(notFound)} had already been deleted`,
      ]),
      type: skipped > 0 || deleted === 0 ? "warning" : "success",
    });
    setSelection((current) => withoutDeleted(current, target));
    router.refresh();
  }

  async function addTo(group: ReceiptGroupRef) {
    setBusyId(group.id);
    let ids: string[];
    let truncated = false;
    if (target.kind === "all") {
      const matching = await matchingIdsRequest(organizationId, filters);
      if (!matching.ok) {
        setBusyId(null);
        toast.add({ title: matching.error, type: "error" });
        return;
      }
      ({ ids, truncated } = matching.data);
    } else {
      ids = [...target.ids];
    }
    const total: MembershipChange = { changed: 0, unchanged: 0, atLimit: 0, notFound: 0 };
    for (let i = 0; i < ids.length; i += MAX_RECEIPTS_PER_CALL) {
      const result = await addReceiptsRequest(group.id, ids.slice(i, i + MAX_RECEIPTS_PER_CALL));
      if (!result.ok) {
        setBusyId(null);
        toast.add({
          title: result.error,
          description: total.changed
            ? `${receiptCount(total.changed)} were added first.`
            : undefined,
          type: "error",
        });
        router.refresh();
        return;
      }
      for (const key of ["changed", "unchanged", "atLimit", "notFound"] as const) {
        total[key] += result.data[key];
      }
    }
    setBusyId(null);
    toast.add({
      title: `Added ${receiptCount(total.changed)} to ${group.name}`,
      description: sentence([
        total.unchanged > 0 && `${receiptCount(total.unchanged)} already in it`,
        total.atLimit > 0 &&
          `${receiptCount(total.atLimit)} skipped: already in ${MAX_GROUPS_PER_RECEIPT} groups`,
        truncated && `Only the first ${receiptCount(ids.length)} that match were added`,
      ]),
      type: total.atLimit || truncated ? "warning" : "success",
    });
    onClose();
    if (fromSelection) setSelection(NOTHING);
    router.refresh();
  }

  async function create(name: string) {
    setBusyId("new");
    const created = await createGroupRequest(name, nextGroupColor(groups.length));
    if (!created.ok) {
      setBusyId(null);
      toast.add({ title: created.error, type: "error" });
      return;
    }
    setGroups((current) => [...current, created.data.group]);
    await addTo(created.data.group);
  }

  const one = n === 1;
  return (
    <>
      <ConfirmDialog
        cancelLabel="Cancel"
        confirmLabel={one ? "Delete receipt" : `Delete ${receiptCount(n)}`}
        description={[
          one ? "Its photo is deleted too." : "Their photos are deleted too.",
          canDeleteAny ? null : "Only receipts you uploaded are deleted.",
          "This can't be undone.",
        ]
          .filter(Boolean)
          .join(" ")}
        destructive
        onConfirm={remove}
        onOpenChange={(open) => !open && onClose()}
        open={pending?.action === "delete"}
        title={one ? "Delete this receipt?" : `Delete ${receiptCount(n)}?`}
      />
      <Dialog
        onOpenChange={(open) => !open && !busyId && onClose()}
        open={pending?.action === "group"}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add to group</DialogTitle>
            <DialogDescription>Adds {receiptCount(n)} to the group you pick.</DialogDescription>
          </DialogHeader>
          <GroupPicker
            busyId={busyId}
            groups={groups}
            mode="action"
            onCreate={create}
            onPick={addTo}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}

function useExport(organizationId: string, filters: HistoryFilters, view: ListView) {
  const [busy, setBusy] = useState(false);
  async function run(selection: Selection) {
    if (selection.kind === "all") {
      const link = document.createElement("a");
      const href = exportHref(filters, view);
      link.href = `${href}${href.includes("?") ? "&" : "?"}${new URLSearchParams({ org: organizationId })}`;
      link.click();
      return;
    }
    setBusy(true);
    const error = await exportSelection(organizationId, [...selection.ids], view.sort);
    setBusy(false);
    if (error) toast.add({ title: error, type: "error" });
  }
  return { busy, run };
}

/**
 * Desktop: a bar that appears once something is selected and stays in reach while scrolling.
 * Phones, in selection mode: a bar over the tab bar, so the actions sit under the thumb.
 */
export function SelectionBars({
  filters,
  view,
  onAction,
}: {
  filters: HistoryFilters;
  view: ListView;
  onAction: (pending: PendingAction) => void;
}) {
  const { selection, setSelection, selecting, organizationId } = useSelection();
  // The tab bar (and Scan's raised button, which rises above it) hides while this bar
  // replaces it; the page keeps the tab bar's bottom inset, so the last row stays clear.
  useEffect(() => {
    if (!selecting) return;
    const root = document.documentElement;
    root.setAttribute("data-selecting", "");
    return () => root.removeAttribute("data-selecting");
  }, [selecting]);
  const exporter = useExport(organizationId, filters, view);
  const n = selectedCount(selection);
  const none = n === 0;
  const open = (action: "delete" | "group") =>
    onAction({ action, target: selection, source: "selection" });

  return (
    <>
      {none ? null : (
        <div
          aria-label="Selected receipts"
          className="sticky bottom-4 z-30 mt-4 hidden items-center gap-2 rounded-xl border border-border bg-popover/95 py-2 pr-2 pl-4 shadow-2xl backdrop-blur md:flex"
          role="toolbar"
        >
          <span className="mr-auto text-sm font-medium">{receiptCount(n)} selected</span>
          <Button onClick={() => setSelection(NOTHING)} size="sm" variant="ghost">
            <X aria-hidden="true" />
            Clear
          </Button>
          <Button onClick={() => open("group")} size="sm" variant="outline">
            <FolderPlus aria-hidden="true" />
            Add to group
          </Button>
          <Button
            disabled={exporter.busy}
            onClick={() => void exporter.run(selection)}
            size="sm"
            variant="outline"
          >
            <Download aria-hidden="true" />
            Export CSV
          </Button>
          <Button onClick={() => open("delete")} size="sm" variant="destructive">
            <Trash2 aria-hidden="true" />
            Delete
          </Button>
        </div>
      )}

      {selecting ? (
        <div
          aria-label="Selected receipts"
          className="fixed inset-x-0 bottom-0 z-50 border-t border-border bg-background pr-[env(safe-area-inset-right)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] md:hidden"
          role="toolbar"
        >
          <div className="grid h-[var(--tabbar-h,4rem)] grid-cols-3">
            {(
              [
                { label: "Add to group", icon: FolderPlus, onClick: () => open("group") },
                {
                  label: "Export",
                  icon: Download,
                  onClick: () => void exporter.run(selection),
                  busy: exporter.busy,
                },
                {
                  label: "Delete",
                  icon: Trash2,
                  onClick: () => open("delete"),
                  destructive: true,
                },
              ] as const
            ).map((item) => {
              const Icon = item.icon;
              return (
                <button
                  className={cn(
                    "flex flex-col items-center justify-center gap-1 text-2xs font-medium outline-none select-none focus-visible:bg-wash focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset active:bg-wash disabled:text-muted-foreground",
                    "destructive" in item ? "text-destructive" : "text-foreground",
                  )}
                  disabled={none || ("busy" in item && item.busy)}
                  key={item.label}
                  onClick={item.onClick}
                  type="button"
                >
                  <Icon aria-hidden="true" className="size-5" />
                  {item.label}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </>
  );
}
