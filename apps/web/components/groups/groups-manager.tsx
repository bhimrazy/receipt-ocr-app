"use client";

import {
  GROUP_NAME_MAX,
  MAX_GROUPS_PER_WORKSPACE,
  type GroupColor,
  type ReceiptGroup,
} from "@receipt-ocr/core/group-rules";
import { Button } from "@receipt-ocr/ui/components/button";
import { Card } from "@receipt-ocr/ui/components/card";
import { ConfirmDialog } from "@receipt-ocr/ui/components/confirm-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@receipt-ocr/ui/components/dialog";
import { Field, FieldError, FieldLabel } from "@receipt-ocr/ui/components/field";
import { Input } from "@receipt-ocr/ui/components/input";
import { toast } from "@receipt-ocr/ui/components/toast";
import { FolderOpen, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { createGroupRequest, deleteGroupRequest, updateGroupRequest } from "./api";
import { ColorField } from "./color-field";
import { GroupDot } from "./group-chip";
import { nextGroupColor } from "./group-colors";
import { groupHistoryHref } from "./hrefs";

const plural = (n: number) => `${n} ${n === 1 ? "receipt" : "receipts"}`;

/** Create, rename, recolour and delete the workspace's groups. */
export function GroupsManager({ groups }: { groups: ReceiptGroup[] }) {
  const [editing, setEditing] = useState<ReceiptGroup | null>(null);
  const [deleting, setDeleting] = useState<ReceiptGroup | null>(null);
  const router = useRouter();

  async function remove(group: ReceiptGroup): Promise<string | void> {
    const result = await deleteGroupRequest(group.id);
    if (!result.ok) return result.error;
    toast.add({ title: `Deleted ${group.name}. Its receipts are kept.`, type: "success" });
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-6">
      <CreateGroupForm count={groups.length} />

      {groups.length === 0 ? (
        <Card className="flex flex-col items-center gap-2 px-6 py-12 text-center">
          <FolderOpen aria-hidden="true" className="size-8 text-muted-foreground" />
          <p className="text-sm font-medium">No groups yet</p>
          <p className="max-w-sm text-sm text-muted-foreground">
            Create one above, or select receipts in the Receipts list and add them to a new group.
          </p>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <ul aria-label="Groups" className="divide-y divide-border">
            {groups.map((group) => (
              <li className="flex min-h-14 items-center gap-3 px-4 py-2" key={group.id}>
                <GroupDot className="size-3" color={group.color} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{group.name}</p>
                  <Link
                    className="text-xs text-muted-foreground underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:underline"
                    href={groupHistoryHref(group.id)}
                  >
                    <span className="font-mono tabular-nums">{group.receiptCount}</span>{" "}
                    {group.receiptCount === 1 ? "receipt" : "receipts"}
                    <span className="sr-only"> in {group.name}</span>
                  </Link>
                </div>
                {group.canManage ? (
                  <div className="flex shrink-0 gap-1">
                    <Button
                      aria-label={`Edit ${group.name}`}
                      onClick={() => setEditing(group)}
                      size="icon-sm"
                      variant="ghost"
                    >
                      <Pencil aria-hidden="true" />
                    </Button>
                    <Button
                      aria-label={`Delete ${group.name}`}
                      onClick={() => setDeleting(group)}
                      size="icon-sm"
                      variant="ghost"
                    >
                      <Trash2 aria-hidden="true" />
                    </Button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <EditGroupDialog group={editing} onClose={() => setEditing(null)} />
      <ConfirmDialog
        cancelLabel="Keep group"
        confirmLabel="Delete group"
        description={
          deleting
            ? `The group is removed for everyone in this workspace. Its ${plural(deleting.receiptCount)} are kept; only the grouping goes.`
            : ""
        }
        destructive
        onConfirm={() => (deleting ? remove(deleting) : undefined)}
        onOpenChange={(open) => !open && setDeleting(null)}
        open={deleting !== null}
        title={deleting ? `Delete “${deleting.name}”?` : "Delete group?"}
      />
    </div>
  );
}

function CreateGroupForm({ count }: { count: number }) {
  const router = useRouter();
  const nameId = useId();
  const errorId = useId();
  const [name, setName] = useState("");
  const [color, setColor] = useState<GroupColor>(nextGroupColor(count));
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const full = count >= MAX_GROUPS_PER_WORKSPACE;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const result = await createGroupRequest(name, color);
    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    toast.add({ title: `Created ${result.data.group.name}`, type: "success" });
    setName("");
    setColor(nextGroupColor(count + 1));
    router.refresh();
  }

  return (
    <Card className="p-4">
      <form className="flex flex-col gap-4" onSubmit={submit}>
        <h2 className="text-sm font-semibold">New group</h2>
        <Field data-invalid={error ? true : undefined}>
          <FieldLabel htmlFor={nameId}>Name</FieldLabel>
          <Input
            aria-describedby={error ? errorId : undefined}
            aria-invalid={error ? true : undefined}
            disabled={full}
            id={nameId}
            maxLength={GROUP_NAME_MAX}
            onChange={(event) => setName(event.target.value)}
            placeholder="Berlin trip"
            required
            value={name}
          />
          {error ? <FieldError id={errorId}>{error}</FieldError> : null}
        </Field>
        <ColorField disabled={full} onChange={setColor} value={color} />
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <Button
            className="sm:self-start"
            disabled={full || pending || !name.trim()}
            type="submit"
          >
            {pending ? (
              <Loader2 aria-hidden="true" className="animate-spin motion-reduce:animate-none" />
            ) : (
              <Plus aria-hidden="true" />
            )}
            Create group
          </Button>
          <p className="text-xs text-muted-foreground">
            {full
              ? `This workspace has ${MAX_GROUPS_PER_WORKSPACE} groups, the most it can have.`
              : `${count} of ${MAX_GROUPS_PER_WORKSPACE} groups used.`}
          </p>
        </div>
      </form>
    </Card>
  );
}

function EditGroupDialog({ group, onClose }: { group: ReceiptGroup | null; onClose: () => void }) {
  return (
    <Dialog onOpenChange={(open) => !open && onClose()} open={group !== null}>
      <DialogContent>
        {/* Keyed so each opening starts from the group's saved values. */}
        {group ? <EditGroupForm group={group} key={group.id} onClose={onClose} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function EditGroupForm({ group, onClose }: { group: ReceiptGroup; onClose: () => void }) {
  const router = useRouter();
  const nameId = useId();
  const errorId = useId();
  const [name, setName] = useState(group.name);
  const [color, setColor] = useState<GroupColor>(group.color);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const patch = {
      ...(name.trim() !== group.name ? { name } : {}),
      ...(color !== group.color ? { color } : {}),
    };
    if (Object.keys(patch).length === 0) return onClose();
    setPending(true);
    setError(null);
    const result = await updateGroupRequest(group.id, patch);
    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    toast.add({ title: "Group saved", type: "success" });
    onClose();
    router.refresh();
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={submit}>
      <DialogHeader>
        <DialogTitle>Edit group</DialogTitle>
        <DialogDescription>Changes show for everyone in this workspace.</DialogDescription>
      </DialogHeader>
      <Field data-invalid={error ? true : undefined}>
        <FieldLabel htmlFor={nameId}>Name</FieldLabel>
        <Input
          aria-describedby={error ? errorId : undefined}
          aria-invalid={error ? true : undefined}
          id={nameId}
          maxLength={GROUP_NAME_MAX}
          onChange={(event) => setName(event.target.value)}
          required
          value={name}
        />
        {error ? <FieldError id={errorId}>{error}</FieldError> : null}
      </Field>
      <ColorField onChange={setColor} value={color} />
      <DialogFooter>
        <Button onClick={onClose} type="button" variant="outline">
          Cancel
        </Button>
        <Button disabled={pending || !name.trim()} type="submit">
          {pending ? (
            <Loader2 aria-hidden="true" className="animate-spin motion-reduce:animate-none" />
          ) : null}
          Save
        </Button>
      </DialogFooter>
    </form>
  );
}
