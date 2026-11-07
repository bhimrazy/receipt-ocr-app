"use client";

import { MAX_GROUPS_PER_RECEIPT, type ReceiptGroupRef } from "@receipt-ocr/core/group-rules";
import { Button, buttonVariants } from "@receipt-ocr/ui/components/button";
import { Card } from "@receipt-ocr/ui/components/card";
import { toast } from "@receipt-ocr/ui/components/toast";
import { cn } from "@receipt-ocr/ui/lib/utils";
import { ChevronLeft, ChevronRight, FolderPlus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { receiptTitle } from "@/components/receipt-list";
import { formatDate, formatMoney } from "@/lib/format";
import { historyHref } from "@/components/history/history-href";
import type { HistoryFilters, ReceiptSummary } from "@/lib/receipts";
import { addReceiptsRequest, createGroupRequest } from "./api";
import { nextGroupColor } from "./group-colors";
import { GroupPicker } from "./group-picker";
import { ResponsivePanel } from "./responsive-panel";

const plural = (n: number) => `${n} ${n === 1 ? "receipt" : "receipts"}`;

/**
 * History in selection mode: this page's receipts with checkboxes, and a bar
 * to add the selected ones to a group (or a new one) in one call.
 */
export function GroupSelectList({
  receipts,
  groups: initialGroups,
  filters,
  page,
  totalPages,
}: {
  receipts: ReceiptSummary[];
  groups: ReceiptGroupRef[];
  filters: HistoryFilters;
  page: number;
  totalPages: number;
}) {
  const router = useRouter();
  const [groups, setGroups] = useState(initialGroups);
  const [chosen, setChosen] = useState<ReadonlySet<string>>(new Set());
  const [open, setOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const allOn = receipts.length > 0 && receipts.every((r) => chosen.has(r.id));
  const someOn = !allOn && receipts.some((r) => chosen.has(r.id));

  function flip(id: string, on: boolean) {
    setChosen((current) => {
      const next = new Set(current);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  async function addTo(group: ReceiptGroupRef) {
    setBusyId(group.id);
    const result = await addReceiptsRequest(group.id, [...chosen]);
    setBusyId(null);
    if (!result.ok) {
      toast.add({ title: result.error, type: "error" });
      return;
    }
    const { changed, unchanged, atLimit } = result.data;
    const notes = [
      unchanged ? `${plural(unchanged)} already in it` : null,
      atLimit ? `${plural(atLimit)} skipped: already in ${MAX_GROUPS_PER_RECEIPT} groups` : null,
    ].filter(Boolean);
    toast.add({
      title: `Added ${plural(changed)} to ${group.name}`,
      description: notes.length ? notes.join(". ") + "." : undefined,
      type: atLimit ? "warning" : "success",
    });
    setOpen(false);
    setChosen(new Set());
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

  if (receipts.length === 0) {
    return (
      <Card className="px-6 py-10 text-center text-sm text-muted-foreground">
        No receipts on this page to select.
      </Card>
    );
  }

  return (
    <>
      <Card className="overflow-hidden">
        <div className="flex min-h-12 items-center gap-3 border-b border-border px-4">
          <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm font-medium">
            <input
              aria-checked={someOn ? "mixed" : allOn}
              checked={allOn}
              className="size-4 accent-primary"
              onChange={(event) =>
                setChosen(event.target.checked ? new Set(receipts.map((r) => r.id)) : new Set())
              }
              ref={(node) => {
                if (node) node.indeterminate = someOn;
              }}
              type="checkbox"
            />
            Select all on this page
          </label>
          <span className="ml-auto text-xs text-muted-foreground">
            Selection is per page; it resets when you change page.
          </span>
        </div>
        <ul aria-label="Receipts to select" className="divide-y divide-border">
          {receipts.map((receipt) => {
            const title = receiptTitle(receipt);
            const completed = receipt.status === "completed";
            const amount = completed ? formatMoney(receipt.total, receipt.currency) : null;
            const date = completed ? formatDate(receipt.receiptDate) : null;
            const on = chosen.has(receipt.id);
            return (
              <li key={receipt.id}>
                <label
                  className={cn(
                    "flex min-h-14 cursor-pointer items-center gap-3 px-4 py-2 hover:bg-wash-subtle",
                    on && "bg-primary/5",
                  )}
                >
                  <input
                    checked={on}
                    className="size-4 shrink-0 accent-primary"
                    onChange={(event) => flip(receipt.id, event.target.checked)}
                    type="checkbox"
                  />
                  <span className="min-w-0 flex-1">
                    <span
                      className={cn(
                        "block truncate text-sm font-medium",
                        title.isFile && "font-mono text-xs text-muted-foreground",
                      )}
                    >
                      {title.text}
                    </span>
                    {date ? (
                      <span className="block text-xs text-muted-foreground">{date}</span>
                    ) : null}
                  </span>
                  {amount ? (
                    <span className="shrink-0 font-mono text-sm tabular-nums">{amount}</span>
                  ) : null}
                </label>
              </li>
            );
          })}
        </ul>
      </Card>

      {/* Sits above the phone tab bar (h-14) and stays in reach while scrolling. */}
      <div
        aria-live="polite"
        className="sticky bottom-20 z-30 mt-4 flex items-center justify-between gap-3 rounded-xl border border-border bg-popover/95 px-4 py-3 shadow-2xl backdrop-blur md:bottom-4"
      >
        <span className="text-sm">
          {chosen.size === 0 ? "Select receipts to group them" : `${plural(chosen.size)} selected`}
        </span>
        <ResponsivePanel
          description={
            chosen.size ? `Adds ${plural(chosen.size)} to the group you pick.` : undefined
          }
          onOpenChange={setOpen}
          open={open}
          title="Add to group"
          trigger={
            <Button disabled={chosen.size === 0} size="sm">
              <FolderPlus aria-hidden="true" />
              Add to group
            </Button>
          }
        >
          <GroupPicker
            busyId={busyId}
            groups={groups}
            mode="action"
            onCreate={create}
            onPick={addTo}
          />
        </ResponsivePanel>
      </div>

      {totalPages > 1 ? (
        <nav
          aria-label="Pagination"
          className="mt-4 flex items-center justify-between text-sm text-muted-foreground"
        >
          <span>
            Page {page} of {totalPages}
          </span>
          <div className="flex gap-2">
            {page > 1 ? (
              <Link
                className={buttonVariants({ size: "sm", variant: "outline" })}
                href={historyHref(filters, page - 1, true)}
              >
                <ChevronLeft aria-hidden="true" />
                Previous
              </Link>
            ) : null}
            {page < totalPages ? (
              <Link
                className={buttonVariants({ size: "sm", variant: "outline" })}
                href={historyHref(filters, page + 1, true)}
              >
                Next
                <ChevronRight aria-hidden="true" />
              </Link>
            ) : null}
          </div>
        </nav>
      ) : null}
    </>
  );
}
