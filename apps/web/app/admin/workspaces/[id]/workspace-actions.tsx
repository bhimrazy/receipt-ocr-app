"use client";

import { withStepUp } from "@/components/step-up/step-up";
import { Button } from "@receipt-ocr/ui/components/button";
import { ConfirmDialog, type ConfirmDialogProps } from "@receipt-ocr/ui/components/confirm-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@receipt-ocr/ui/components/select";
import { toast } from "@receipt-ocr/ui/components/toast";
import { Trash2, UserMinus, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { formatDate } from "@/lib/format";
import {
  cancelInvitationAction,
  deleteWorkspaceAction,
  removeMemberAction,
  setMemberRoleAction,
  type ActionResult,
} from "../../actions";

type Confirm = Omit<ConfirmDialogProps, "open" | "onOpenChange">;

export type WorkspaceMember = {
  memberId: string;
  userId: string;
  name: string;
  email: string;
  role: string;
  joinedAt: string;
  receipts: number;
};

export type WorkspaceInvitation = {
  id: string;
  email: string;
  role: string | null;
  expiresAt: string;
  inviterEmail: string | null;
};

const ROLES = [
  { value: "owner", label: "Owner" },
  { value: "admin", label: "Admin" },
  { value: "member", label: "Member" },
];
const label = (role: string) => ROLES.find((r) => r.value === role)?.label ?? role;

async function settle(call: () => Promise<ActionResult>, success: string): Promise<string | void> {
  const result = await withStepUp(call);
  if (!result.ok) return result.error;
  toast.add({ title: success, type: "success" });
}

function useConfirm() {
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [open, setOpen] = useState(false);
  const dialog = confirm ? <ConfirmDialog onOpenChange={setOpen} open={open} {...confirm} /> : null;
  return {
    dialog,
    ask: (next: Confirm) => {
      setConfirm(next);
      setOpen(true);
    },
  };
}

export function MembersTable({
  organizationId,
  workspaceName,
  members,
}: {
  organizationId: string;
  workspaceName: string;
  members: WorkspaceMember[];
}) {
  const { dialog, ask } = useConfirm();
  const owners = members.filter((m) => m.role === "owner").length;

  return (
    <>
      <ul className="divide-y divide-border rounded-lg border border-border bg-card">
        {members.map((m) => {
          const lastOwner = m.role === "owner" && owners === 1;
          return (
            <li
              className="grid gap-3 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
              key={m.memberId}
            >
              <div className="min-w-0">
                <Link
                  className="block truncate rounded-sm text-sm font-medium outline-none hover:text-primary focus-visible:ring-2 focus-visible:ring-ring"
                  href={`/admin/users/${m.userId}`}
                >
                  {m.name || m.email}
                </Link>
                <p className="truncate text-xs text-muted-foreground">{m.email}</p>
                <p className="mt-0.5 font-mono text-xs text-muted-foreground tabular-nums">
                  {m.receipts} receipts here · joined {formatDate(m.joinedAt)}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Select
                  items={ROLES}
                  onValueChange={(next) => {
                    if (!next || next === m.role) return;
                    ask({
                      title: `Make ${m.email} ${next === "admin" ? "an" : "a"} ${label(next).toLowerCase()} of ${workspaceName}?`,
                      description:
                        next === "owner"
                          ? "Owners can delete the workspace and manage every member."
                          : next === "admin"
                            ? "Admins can invite and remove members and delete any receipt."
                            : "Members can upload and see every receipt, and delete only their own.",
                      confirmLabel: "Change role",
                      onConfirm: () =>
                        settle(
                          () =>
                            setMemberRoleAction({
                              organizationId,
                              memberId: m.memberId,
                              role: next,
                            }),
                          "Role changed.",
                        ),
                    });
                  }}
                  value={m.role}
                >
                  <SelectTrigger
                    aria-label={`Workspace role for ${m.email}`}
                    className="w-32"
                    disabled={lastOwner}
                    title={
                      lastOwner ? "The only owner. Make someone else an owner first." : undefined
                    }
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent alignItemWithTrigger={false}>
                    {ROLES.map((r) => (
                      <SelectItem key={r.value} value={r.value}>
                        {r.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  aria-label={`Remove ${m.email} from ${workspaceName}`}
                  disabled={lastOwner}
                  onClick={() =>
                    ask({
                      title: `Remove ${m.email} from ${workspaceName}?`,
                      description:
                        "They lose access to this workspace straight away. Receipts they uploaded stay here.",
                      confirmLabel: "Remove member",
                      destructive: true,
                      onConfirm: () =>
                        settle(
                          () => removeMemberAction({ organizationId, memberId: m.memberId }),
                          "Member removed.",
                        ),
                    })
                  }
                  size="icon"
                  variant="ghost"
                >
                  <UserMinus aria-hidden="true" />
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
      {owners === 1 ? (
        <p className="mt-2 text-xs text-muted-foreground">
          The only owner can&apos;t be removed or changed. Make another member an owner first.
        </p>
      ) : null}
      {dialog}
    </>
  );
}

export function InvitationsList({
  organizationId,
  invitations,
}: {
  organizationId: string;
  invitations: WorkspaceInvitation[];
}) {
  const { dialog, ask } = useConfirm();
  if (invitations.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
        No pending invitations.
      </p>
    );
  }
  return (
    <>
      <ul className="divide-y divide-border rounded-lg border border-border bg-card">
        {invitations.map((inv) => (
          <li className="flex items-center justify-between gap-3 px-4 py-3" key={inv.id}>
            <div className="min-w-0">
              <p className="truncate text-sm">{inv.email}</p>
              <p className="truncate text-xs text-muted-foreground">
                {label(inv.role ?? "member")} · expires {formatDate(inv.expiresAt)}
                {inv.inviterEmail ? ` · invited by ${inv.inviterEmail}` : ""}
              </p>
            </div>
            <Button
              aria-label={`Cancel the invitation for ${inv.email}`}
              onClick={() =>
                ask({
                  title: `Cancel the invitation for ${inv.email}?`,
                  description: "The link in their email stops working.",
                  confirmLabel: "Cancel invitation",
                  cancelLabel: "Keep it",
                  destructive: true,
                  onConfirm: () =>
                    settle(
                      () => cancelInvitationAction({ organizationId, invitationId: inv.id }),
                      "Invitation cancelled.",
                    ),
                })
              }
              size="sm"
              variant="ghost"
            >
              <X aria-hidden="true" />
              Cancel
            </Button>
          </li>
        ))}
      </ul>
      {dialog}
    </>
  );
}

export function DeleteWorkspace({
  organizationId,
  name,
  receipts,
  members,
}: {
  organizationId: string;
  name: string;
  receipts: number;
  members: number;
}) {
  const { dialog, ask } = useConfirm();
  return (
    <>
      <Button
        onClick={() =>
          ask({
            title: `Delete ${name}?`,
            description: `This deletes the workspace, its ${receipts} ${receipts === 1 ? "receipt" : "receipts"} and their images, and removes its ${members} ${members === 1 ? "member" : "members"}. Their accounts stay. This can't be undone.`,
            confirmLabel: "Delete workspace",
            confirmText: name,
            destructive: true,
            onConfirm: (typed) =>
              settle(
                () => deleteWorkspaceAction({ organizationId, confirm: typed }),
                "Workspace deleted.",
              ),
          })
        }
        variant="destructive"
      >
        <Trash2 aria-hidden="true" />
        Delete workspace
      </Button>
      {dialog}
    </>
  );
}
