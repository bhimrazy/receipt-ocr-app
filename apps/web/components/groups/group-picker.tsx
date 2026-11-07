"use client";

import {
  GROUP_NAME_MAX,
  MAX_GROUPS_PER_WORKSPACE,
  type ReceiptGroupRef,
} from "@receipt-ocr/core/group-rules";
import { Input } from "@receipt-ocr/ui/components/input";
import { Label } from "@receipt-ocr/ui/components/label";
import { cn } from "@receipt-ocr/ui/lib/utils";
import { Loader2, Plus } from "lucide-react";
import { useId, useState } from "react";
import { GroupDot } from "./group-chip";

const ROW =
  "flex min-h-10 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-sm outline-none hover:bg-wash focus-visible:ring-2 focus-visible:ring-ring max-md:min-h-11";

const normalise = (name: string) => name.replace(/\s+/g, " ").trim();

/**
 * Search the workspace's groups and pick one, or create one from the search
 * text. "toggle" shows a checkbox per group (a receipt's groups); "action"
 * makes each group a button (add the selection to it). Enter picks the exact
 * match, or creates the group when there is none.
 */
export function GroupPicker({
  groups,
  mode,
  selected,
  busyId,
  onPick,
  onCreate,
}: {
  groups: ReceiptGroupRef[];
  mode: "toggle" | "action";
  /** Ids that are checked, in toggle mode. */
  selected?: ReadonlySet<string>;
  /** The group being saved; its row is disabled. "new" while creating. */
  busyId?: string | null;
  onPick: (group: ReceiptGroupRef, checked: boolean) => void;
  onCreate: (name: string) => void;
}) {
  const searchId = useId();
  const listId = useId();
  const [query, setQuery] = useState("");
  const wanted = normalise(query);
  const lower = wanted.toLowerCase();
  const shown = lower ? groups.filter((g) => g.name.toLowerCase().includes(lower)) : groups;
  const exact = groups.find((g) => g.name.toLowerCase() === lower);
  const full = groups.length >= MAX_GROUPS_PER_WORKSPACE;
  const canCreate = Boolean(wanted) && !exact && !full && wanted.length <= GROUP_NAME_MAX;
  const busy = Boolean(busyId);

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter" || busy) return;
    event.preventDefault();
    if (exact) onPick(exact, !(selected?.has(exact.id) ?? false));
    else if (canCreate) onCreate(wanted);
  }

  return (
    <div className="flex flex-col gap-2">
      <Label className="text-xs text-muted-foreground" htmlFor={searchId}>
        Search or create a group
      </Label>
      <Input
        aria-controls={listId}
        autoComplete="off"
        id={searchId}
        maxLength={GROUP_NAME_MAX + 20}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={onKeyDown}
        placeholder="Berlin trip, Client A…"
        type="search"
        value={query}
      />
      <ul aria-label="Groups" className="-mx-1 flex max-h-64 flex-col overflow-y-auto" id={listId}>
        {shown.map((group) => {
          const checked = selected?.has(group.id) ?? false;
          const rowBusy = busyId === group.id;
          return (
            <li key={group.id}>
              {mode === "toggle" ? (
                <label className={cn(ROW, "cursor-pointer has-focus-visible:ring-2")}>
                  <input
                    checked={checked}
                    className="size-4 shrink-0 accent-primary"
                    disabled={busy}
                    onChange={(event) => onPick(group, event.target.checked)}
                    type="checkbox"
                  />
                  <GroupDot color={group.color} />
                  <span className="min-w-0 flex-1 truncate">{group.name}</span>
                  {rowBusy ? <Spinner /> : null}
                </label>
              ) : (
                <button
                  className={ROW}
                  disabled={busy}
                  onClick={() => onPick(group, true)}
                  type="button"
                >
                  <GroupDot color={group.color} />
                  <span className="min-w-0 flex-1 truncate">{group.name}</span>
                  {rowBusy ? <Spinner /> : null}
                </button>
              )}
            </li>
          );
        })}
        {shown.length === 0 && !canCreate ? (
          <li className="px-2.5 py-2 text-sm text-muted-foreground">
            {groups.length === 0
              ? "No groups yet. Type a name to create one."
              : "No group matches."}
          </li>
        ) : null}
      </ul>
      {canCreate ? (
        <button
          className={cn(ROW, "-mx-1 w-auto border border-dashed border-border text-primary")}
          disabled={busy}
          onClick={() => onCreate(wanted)}
          type="button"
        >
          {busyId === "new" ? <Spinner /> : <Plus aria-hidden="true" className="size-4" />}
          <span className="min-w-0 truncate">Create “{wanted}”</span>
        </button>
      ) : null}
      {wanted.length > GROUP_NAME_MAX ? (
        <p className="text-xs text-destructive" role="alert">
          Group names can be up to {GROUP_NAME_MAX} characters.
        </p>
      ) : null}
      {full && wanted && !exact ? (
        <p className="text-xs text-muted-foreground">
          This workspace has {MAX_GROUPS_PER_WORKSPACE} groups, the most it can have. Delete one on
          the Groups page to make room.
        </p>
      ) : null}
    </div>
  );
}

function Spinner() {
  return (
    <Loader2
      aria-label="Saving"
      className="size-4 shrink-0 animate-spin text-muted-foreground motion-reduce:animate-none"
    />
  );
}
