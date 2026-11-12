"use client";

import type { ReceiptGroupRef } from "@receipt-ocr/core/group-rules";
import { Button, buttonVariants } from "@receipt-ocr/ui/components/button";
import { Card } from "@receipt-ocr/ui/components/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@receipt-ocr/ui/components/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@receipt-ocr/ui/components/table";
import { cn } from "@receipt-ocr/ui/lib/utils";
import {
  ArrowDown,
  ArrowUp,
  ChevronsUpDown,
  ExternalLink,
  FolderPlus,
  MoreHorizontal,
  Search,
  Trash2,
  Upload,
} from "lucide-react";
import Link from "next/link";
import { useRef, useState } from "react";
import { historyHref, isFiltered } from "@/components/history/history-href";
import { ReceiptRowContent, receiptTitle, ROW_LINK } from "@/components/receipt-list";
import { ConfidenceBadge, StatusBadge } from "@/components/receipt-status";
import { RetryReceiptButton } from "@/components/retry-receipt-button";
import { confidenceLevel, formatDate, formatMoney } from "@/lib/format";
import { canEditReceipt } from "@/lib/receipt-permissions";
import type { HistoryFilters, ReceiptSummary } from "@/lib/receipts";
import { HistoryPagination } from "./history-pagination";
import { nextSort, type ListView, type SortKey } from "./list-view";
import {
  canSelectAllMatching,
  isSelected,
  NOTHING,
  pageState,
  receiptCount,
  toggle,
  togglePage,
} from "./selection";
import { SelectionBars, SelectionDialogs, type PendingAction } from "./selection-actions";
import { useSelection } from "./selection-context";

type Viewer = { userId: string; role: string };

function Missing() {
  return (
    <>
      <span aria-hidden="true" className="text-muted-foreground">
        —
      </span>
      <span className="sr-only">Not available</span>
    </>
  );
}

/** A low-confidence read, a failed one or one still scanning; a receipt that is fine shows nothing. */
function needsAttention(receipt: ReceiptSummary) {
  if (receipt.status !== "completed") return true;
  const level = confidenceLevel(receipt.confidence);
  return level !== null && level !== "high";
}

/** The status column: only what needs attention, with Try again on a failed read. */
function RowStatus({ receipt, retry = true }: { receipt: ReceiptSummary; retry?: boolean }) {
  if (!needsAttention(receipt)) return <span className="sr-only">Done</span>;
  if (receipt.status === "completed") return <ConfidenceBadge value={receipt.confidence} />;
  return (
    <div className="flex items-center gap-2">
      <StatusBadge status={receipt.status} />
      {retry && receipt.status === "failed" ? (
        <RetryReceiptButton
          className="relative z-10"
          receiptId={receipt.id}
          size="sm"
          variant="ghost"
        />
      ) : null}
    </div>
  );
}

function uploaderLabel(receipt: ReceiptSummary, viewer: Viewer) {
  if (receipt.userId === viewer.userId) return "You";
  return receipt.uploaderName ?? "Former member";
}

function SortHeader({
  label,
  by,
  view,
  filters,
  className,
}: {
  label: string;
  by: SortKey;
  view: ListView;
  filters: HistoryFilters;
  className?: string;
}) {
  const active = view.sort?.by === by ? view.sort.dir : null;
  const Icon = active === "asc" ? ArrowUp : active === "desc" ? ArrowDown : ChevronsUpDown;
  return (
    <TableHead
      aria-sort={active === "asc" ? "ascending" : active === "desc" ? "descending" : undefined}
      className={className}
    >
      <Link
        className={cn(
          "-mx-1.5 inline-flex h-8 items-center gap-1 rounded-md px-1.5 uppercase outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
          active && "text-foreground",
        )}
        href={historyHref(filters, 1, { ...view, sort: nextSort(view.sort, by) })}
        replace
        scroll={false}
      >
        {label}
        <Icon aria-hidden="true" className={cn("size-3.5", !active && "opacity-50")} />
        <span className="sr-only">
          {active ? `, sorted ${active === "asc" ? "ascending" : "descending"}` : ", sort"}
        </span>
      </Link>
    </TableHead>
  );
}

/** A native checkbox: one tab stop, Space toggles, and `indeterminate` for a part-selected page. */
function Check({
  checked,
  indeterminate = false,
  onChange,
  label,
  className,
}: {
  checked: boolean;
  indeterminate?: boolean;
  onChange: (on: boolean) => void;
  label: string;
  className?: string;
}) {
  return (
    <input
      aria-label={label}
      checked={checked}
      className={cn("size-4 shrink-0 cursor-pointer accent-primary", className)}
      onChange={(event) => onChange(event.target.checked)}
      ref={(node) => {
        if (node) node.indeterminate = indeterminate;
      }}
      type="checkbox"
    />
  );
}

/** Starts phone selection when a row is held, and swallows the tap that ends the hold. */
function useLongPress(onLongPress: (id: string) => void) {
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const start = useRef<{ x: number; y: number } | null>(null);
  const fired = useRef(false);
  const cancel = () => {
    clearTimeout(timer.current);
    start.current = null;
  };
  return (id: string) => ({
    onPointerDown(event: React.PointerEvent) {
      if (event.pointerType === "mouse") return;
      fired.current = false;
      start.current = { x: event.clientX, y: event.clientY };
      timer.current = setTimeout(() => {
        fired.current = true;
        start.current = null;
        // The hold may have started selecting the row's text.
        window.getSelection()?.removeAllRanges();
        navigator.vibrate?.(10);
        onLongPress(id);
      }, 500);
    },
    onPointerMove(event: React.PointerEvent) {
      const from = start.current;
      if (from && Math.hypot(event.clientX - from.x, event.clientY - from.y) > 10) cancel();
    },
    onPointerUp: cancel,
    onPointerCancel: cancel,
    onClickCapture(event: React.MouseEvent) {
      if (!fired.current) return;
      fired.current = false;
      event.preventDefault();
      event.stopPropagation();
    },
    onContextMenu(event: React.MouseEvent) {
      // Android opens the link menu on a long press; the hold selects instead.
      if (fired.current || start.current) event.preventDefault();
    },
  });
}

/** One page of History: a table from md, stacked rows below; selection, actions and paging. */
export function HistoryResults({
  receipts,
  total,
  page,
  filters,
  view,
  groups,
  viewer,
  shared,
}: {
  receipts: ReceiptSummary[];
  total: number;
  page: number;
  filters: HistoryFilters;
  view: ListView;
  groups: ReceiptGroupRef[];
  viewer: Viewer;
  /** More than one member: show who uploaded each receipt. */
  shared: boolean;
}) {
  const { selection, setSelection, selecting, setSelecting } = useSelection();
  const [pending, setPending] = useState<PendingAction>(null);
  const pageIds = receipts.map((r) => r.id);
  const state = pageState(selection, pageIds);
  const canDeleteAny = canEditReceipt(viewer, { userId: null });
  const longPress = useLongPress((id) => {
    setSelecting(true);
    setSelection((current) => toggle(current, id, true, pageIds));
  });
  const flip = (id: string, on: boolean) =>
    setSelection((current) => toggle(current, id, on, pageIds));
  const flipPage = (on: boolean) => setSelection((current) => togglePage(current, pageIds, on));

  // Shared by the empty state: rows picked on other pages are still selected there.
  const actions = (
    <>
      <SelectionBars filters={filters} onAction={setPending} view={view} />
      <SelectionDialogs
        canDeleteAny={canDeleteAny}
        filters={filters}
        groups={groups}
        onClose={() => setPending(null)}
        pending={pending}
      />
    </>
  );

  if (receipts.length === 0) {
    return (
      <>
        <EmptyState
          filtered={isFiltered(filters)}
          firstPage={page > 1 && total > 0 ? historyHref(filters, 1, view) : null}
        />
        {actions}
      </>
    );
  }

  const allMatching = selection.kind === "all";
  const banner =
    allMatching || canSelectAllMatching(selection, pageIds, total) ? (
      <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 border-b border-border bg-primary/5 px-4 py-2 text-center text-sm">
        {allMatching ? (
          <>
            <span>All {receiptCount(total)} that match are selected.</span>
            <Button onClick={() => setSelection(NOTHING)} size="sm" variant="link">
              Clear selection
            </Button>
          </>
        ) : (
          <>
            <span>All {receiptCount(receipts.length)} on this page are selected.</span>
            <Button onClick={() => setSelection({ kind: "all", total })} size="sm" variant="link">
              Select all {receiptCount(total)} that match
            </Button>
          </>
        )}
      </div>
    ) : null;

  return (
    <>
      {/* Phones: stacked rows; "Select" or a long press turns them into checkboxes. */}
      <Card className="overflow-hidden md:hidden">
        {selecting ? (
          <>
            <div className="flex min-h-12 items-center gap-3 border-b border-border px-4">
              <label className="flex min-h-11 flex-1 cursor-pointer items-center gap-3 text-sm font-medium">
                <Check
                  checked={state === "all"}
                  indeterminate={state === "some"}
                  label="Select all on this page"
                  onChange={flipPage}
                />
                <span aria-hidden="true">All on this page</span>
              </label>
              <span className="text-xs text-muted-foreground">
                {receiptCount(allMatching ? total : selection.ids.size)} selected
              </span>
            </div>
            {banner}
          </>
        ) : null}
        <ul aria-label="Receipts" className="divide-y divide-border">
          {receipts.map((receipt) => {
            const title = receiptTitle(receipt);
            const on = isSelected(selection, receipt.id);
            return (
              <li
                className={cn(
                  "group relative flex items-center gap-3 transition-colors [-webkit-touch-callout:none] focus-within:bg-wash-subtle hover:bg-wash-subtle active:bg-wash",
                  // Amounts and names stay selectable outside selection mode.
                  selecting && "select-none",
                  selecting && on && "bg-primary/5",
                )}
                key={receipt.id}
                {...longPress(receipt.id)}
              >
                {selecting ? (
                  <label className="flex min-h-14 w-full cursor-pointer items-center gap-3 px-4 py-3">
                    <Check
                      checked={on}
                      label={`Select ${title.text}`}
                      onChange={(next) => flip(receipt.id, next)}
                    />
                    <ReceiptRowContent
                      receipt={receipt}
                      retry={false}
                      title={
                        <span
                          aria-hidden="true"
                          className={cn(
                            "min-w-0 truncate text-sm font-medium",
                            title.isFile && "font-mono text-xs",
                          )}
                        >
                          {title.text}
                        </span>
                      }
                    />
                  </label>
                ) : (
                  <div className="flex w-full items-center gap-3 px-4 py-3">
                    <ReceiptRowContent
                      receipt={receipt}
                      title={
                        <Link
                          className={cn(ROW_LINK, title.isFile && "font-mono text-xs")}
                          data-touch-row=""
                          href={`/app/receipts/${receipt.id}`}
                        >
                          {title.text}
                        </Link>
                      }
                    />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </Card>

      {/* From md: a table; checkboxes are always there, so no selection mode. */}
      <Card className="hidden overflow-hidden md:block">
        {banner}
        <Table className="table-fixed">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-11 pr-0 pl-4">
                <label className="-m-2 flex size-8 cursor-pointer items-center justify-center">
                  <Check
                    checked={state === "all"}
                    indeterminate={state === "some"}
                    label="Select all on this page"
                    onChange={flipPage}
                  />
                </label>
              </TableHead>
              <SortHeader by="merchant" filters={filters} label="Merchant" view={view} />
              <SortHeader
                by="date"
                className="w-32 px-2 lg:px-4"
                filters={filters}
                label="Date"
                view={view}
              />
              <TableHead className="hidden w-36 xl:table-cell">Category</TableHead>
              {shared ? (
                <TableHead className="hidden w-36 xl:table-cell">Uploaded by</TableHead>
              ) : null}
              <TableHead className="hidden w-40 lg:table-cell">Status</TableHead>
              <SortHeader
                by="total"
                className="w-32 px-2 text-right lg:px-4"
                filters={filters}
                label="Total"
                view={view}
              />
              <TableHead className="w-12 px-2">
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {receipts.map((receipt) => {
              const title = receiptTitle(receipt);
              const on = isSelected(selection, receipt.id);
              const completed = receipt.status === "completed";
              const amount = completed ? formatMoney(receipt.total, receipt.currency) : null;
              const date = completed ? formatDate(receipt.receiptDate) : null;
              const target = { kind: "ids" as const, ids: new Set([receipt.id]) };
              return (
                <TableRow
                  className={cn("relative focus-within:bg-muted/40", on && "bg-primary/5")}
                  data-state={on ? "selected" : undefined}
                  key={receipt.id}
                >
                  <TableCell className="relative z-10 pr-0 pl-4">
                    <label className="-m-2 flex size-8 cursor-pointer items-center justify-center">
                      <Check
                        checked={on}
                        label={`Select ${title.text}`}
                        onChange={(next) => flip(receipt.id, next)}
                      />
                    </label>
                  </TableCell>
                  <TableCell className="min-w-0">
                    <Link
                      className={cn(
                        "block truncate font-medium outline-none after:absolute after:inset-0 after:content-[''] focus-visible:underline",
                        title.isFile && "font-mono text-xs text-muted-foreground",
                      )}
                      href={`/app/receipts/${receipt.id}`}
                    >
                      {title.text}
                    </Link>
                    {/* The Status column only fits from lg; until then it sits under the name. */}
                    {needsAttention(receipt) ? (
                      <div className="mt-1 lg:hidden">
                        <RowStatus receipt={receipt} retry={false} />
                      </div>
                    ) : null}
                  </TableCell>
                  <TableCell className="px-2 whitespace-nowrap text-muted-foreground lg:px-4">
                    {date ?? <Missing />}
                  </TableCell>
                  <TableCell className="hidden truncate text-muted-foreground xl:table-cell">
                    {completed && receipt.category ? receipt.category : <Missing />}
                  </TableCell>
                  {shared ? (
                    <TableCell className="hidden truncate text-muted-foreground xl:table-cell">
                      {uploaderLabel(receipt, viewer)}
                    </TableCell>
                  ) : null}
                  <TableCell className="hidden lg:table-cell">
                    <RowStatus receipt={receipt} />
                  </TableCell>
                  <TableCell className="px-2 text-right lg:px-4">
                    {amount ? (
                      <span className="font-mono tabular-nums">{amount}</span>
                    ) : (
                      <Missing />
                    )}
                  </TableCell>
                  <TableCell className="relative z-10 px-2">
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        render={
                          <Button
                            aria-label={`Actions for ${title.text}`}
                            size="icon-sm"
                            variant="ghost"
                          />
                        }
                      >
                        <MoreHorizontal aria-hidden="true" />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-44">
                        <DropdownMenuGroup>
                          <DropdownMenuItem render={<Link href={`/app/receipts/${receipt.id}`} />}>
                            <ExternalLink aria-hidden="true" />
                            Open
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => setPending({ action: "group", target, source: "row" })}
                          >
                            <FolderPlus aria-hidden="true" />
                            Add to group
                          </DropdownMenuItem>
                        </DropdownMenuGroup>
                        {canEditReceipt(viewer, receipt) ? (
                          <>
                            <DropdownMenuSeparator />
                            <DropdownMenuGroup>
                              <DropdownMenuItem
                                onClick={() =>
                                  setPending({ action: "delete", target, source: "row" })
                                }
                                variant="destructive"
                              >
                                <Trash2 aria-hidden="true" />
                                Delete
                              </DropdownMenuItem>
                            </DropdownMenuGroup>
                          </>
                        ) : null}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Card>

      <HistoryPagination filters={filters} page={page} total={total} view={view} />
      {actions}
    </>
  );
}

/** `firstPage` is set on a page past the end (its last rows were just deleted). */
function EmptyState({ filtered, firstPage }: { filtered: boolean; firstPage: string | null }) {
  const pastEnd = firstPage !== null;
  return (
    <Card className="flex flex-col items-center gap-3 px-6 py-14 text-center">
      <span className="flex size-11 items-center justify-center rounded-full border border-border bg-secondary/40 text-muted-foreground">
        {filtered || pastEnd ? (
          <Search aria-hidden="true" className="size-5" />
        ) : (
          <Upload aria-hidden="true" className="size-5" />
        )}
      </span>
      <div>
        <p className="text-sm font-medium">
          {pastEnd
            ? "No receipts on this page"
            : filtered
              ? "No receipts match"
              : "No receipts yet"}
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          {pastEnd
            ? "The list is shorter than this page."
            : filtered
              ? "Try a different search, category or date range."
              : "Receipts uploaded to this workspace appear here, newest first."}
        </p>
      </div>
      {firstPage ? (
        <Link
          className={cn(buttonVariants({ variant: "outline", size: "sm" }), "mt-1")}
          href={firstPage}
        >
          Go to the first page
        </Link>
      ) : filtered ? (
        <Link
          className={cn(buttonVariants({ variant: "outline", size: "sm" }), "mt-1")}
          href="/app/history"
        >
          Clear filters
        </Link>
      ) : (
        <Link className={cn(buttonVariants({ size: "sm" }), "mt-1")} href="/app">
          <Upload aria-hidden="true" />
          Upload a receipt
        </Link>
      )}
    </Card>
  );
}
