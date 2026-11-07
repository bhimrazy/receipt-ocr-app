"use client";

import type { ReceiptGroup } from "@receipt-ocr/core/group-rules";
import { buttonVariants } from "@receipt-ocr/ui/components/button";
import { cn } from "@receipt-ocr/ui/lib/utils";
import { CheckSquare, FolderCog, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { GroupDot } from "./group-chip";
import { SELECT_PARAM } from "./hrefs";

/**
 * History's group chips: each toggles `?group=<id>` (several mean "in any of
 * them"). Also the way into selection mode and the Groups page.
 */
export function GroupFilter({
  groups,
  selectedIds,
  selecting,
}: {
  groups: ReceiptGroup[];
  selectedIds: string[];
  selecting: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();
  const active = new Set(selectedIds);

  function navigate(params: URLSearchParams) {
    params.delete("page");
    const qs = params.toString();
    startTransition(() => router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
  }

  function toggle(id: string) {
    const params = new URLSearchParams(searchParams.toString());
    const next = active.has(id) ? selectedIds.filter((g) => g !== id) : [...selectedIds, id];
    params.delete("group");
    for (const g of next) params.append("group", g);
    navigate(params);
  }

  function clearGroups() {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("group");
    navigate(params);
  }

  const selectHref = (() => {
    const params = new URLSearchParams(searchParams.toString());
    if (selecting) params.delete(SELECT_PARAM);
    else params.set(SELECT_PARAM, "1");
    const qs = params.toString();
    return qs ? `${pathname}?${qs}` : pathname;
  })();

  return (
    <div aria-busy={pending} className="mb-5 flex flex-col gap-2 sm:flex-row sm:items-center">
      {groups.length > 0 ? (
        <div
          aria-label="Filter by group"
          className="scroll-fade-x -mx-1 flex min-w-0 flex-1 gap-2 overflow-x-auto px-1 py-0.5"
          role="group"
        >
          {groups.map((group) => {
            const on = active.has(group.id);
            return (
              <button
                aria-pressed={on}
                className={cn(
                  buttonVariants({ size: "sm", variant: on ? "secondary" : "ghost" }),
                  "max-w-56 shrink-0 border-border",
                  on && "border-primary/40 text-foreground",
                )}
                key={group.id}
                onClick={() => toggle(group.id)}
                type="button"
              >
                <GroupDot color={group.color} />
                <span className="truncate">{group.name}</span>
                <span className="font-mono text-muted-foreground tabular-nums">
                  {group.receiptCount}
                </span>
              </button>
            );
          })}
          {active.size > 0 ? (
            <button
              className={cn(buttonVariants({ size: "sm", variant: "ghost" }), "shrink-0")}
              onClick={clearGroups}
              type="button"
            >
              <X aria-hidden="true" />
              All groups
            </button>
          ) : null}
        </div>
      ) : (
        <p className="flex-1 text-sm text-muted-foreground">
          Group receipts by trip, client or year: select them, then add them to a group.
        </p>
      )}
      <div className="flex shrink-0 gap-2">
        <Link
          className={buttonVariants({ size: "sm", variant: selecting ? "secondary" : "outline" })}
          href={selectHref}
          replace
          scroll={false}
        >
          <CheckSquare aria-hidden="true" />
          {selecting ? "Done selecting" : "Select"}
        </Link>
        <Link className={buttonVariants({ size: "sm", variant: "ghost" })} href="/app/groups">
          <FolderCog aria-hidden="true" />
          Manage groups
        </Link>
      </div>
    </div>
  );
}
