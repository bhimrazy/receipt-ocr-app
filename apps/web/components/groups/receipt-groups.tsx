"use client";

import type { ReceiptGroupRef } from "@receipt-ocr/core/group-rules";
import { Button } from "@receipt-ocr/ui/components/button";
import { toast } from "@receipt-ocr/ui/components/toast";
import { FolderPlus } from "lucide-react";
import { useState } from "react";
import { createGroupRequest, setReceiptInGroupRequest } from "./api";
import { GroupChip } from "./group-chip";
import { nextGroupColor } from "./group-colors";
import { GroupPicker } from "./group-picker";
import { groupHistoryHref } from "./hrefs";
import { ResponsivePanel } from "./responsive-panel";

/**
 * A receipt's groups as chips, with "Add to group": a searchable picker that
 * can create a group inline. Any member of the workspace may change these.
 */
export function ReceiptGroups({
  receiptId,
  groups: initialGroups,
  inGroups: initialIn,
}: {
  receiptId: string;
  /** Every group in the workspace. */
  groups: ReceiptGroupRef[];
  /** The groups this receipt is in. */
  inGroups: ReceiptGroupRef[];
}) {
  const [groups, setGroups] = useState(initialGroups);
  const [inGroups, setInGroups] = useState(initialIn);
  const [open, setOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const selected = new Set(inGroups.map((g) => g.id));

  async function setMembership(group: ReceiptGroupRef, add: boolean) {
    // Optimistic, so the checkbox or chip responds at once; the server's list wins after.
    const before = inGroups;
    setInGroups(add ? [...before, group] : before.filter((g) => g.id !== group.id));
    setBusyId(group.id);
    const result = await setReceiptInGroupRequest(receiptId, group.id, add);
    setBusyId(null);
    if (!result.ok) {
      setInGroups(before);
      toast.add({ title: result.error, type: "error" });
      return;
    }
    setInGroups(result.data.groups);
  }

  async function create(name: string) {
    setBusyId("new");
    const created = await createGroupRequest(name, nextGroupColor(groups.length));
    if (!created.ok) {
      setBusyId(null);
      toast.add({ title: created.error, type: "error" });
      return;
    }
    const group = created.data.group;
    setGroups((current) =>
      [...current, group].sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
      ),
    );
    await setMembership(group, true);
  }

  return (
    <div aria-label="Groups" className="flex flex-wrap items-center gap-2" role="group">
      {inGroups.map((group) => (
        <GroupChip
          group={group}
          href={groupHistoryHref(group.id)}
          key={group.id}
          onRemove={() => setMembership(group, false)}
          removing={busyId === group.id}
        />
      ))}
      <ResponsivePanel
        description="Groups collect receipts for a trip, a client or a year. A receipt can be in several."
        onOpenChange={setOpen}
        open={open}
        title="Add to group"
        trigger={
          <Button size="sm" variant="outline">
            <FolderPlus aria-hidden="true" />
            Add to group
          </Button>
        }
      >
        <GroupPicker
          busyId={busyId}
          groups={groups}
          mode="toggle"
          onCreate={create}
          onPick={setMembership}
          selected={selected}
        />
      </ResponsivePanel>
    </div>
  );
}
