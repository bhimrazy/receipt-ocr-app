"use client";

import { Alert } from "@receipt-ocr/ui/components/alert";
import { Badge } from "@receipt-ocr/ui/components/badge";
import { Button } from "@receipt-ocr/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@receipt-ocr/ui/components/card";
import { ConfirmDialog } from "@receipt-ocr/ui/components/confirm-dialog";
import { Loader2, Trash2, Users } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { authClient } from "@/lib/auth-client";
import { RoleSelect } from "./role-select";
import { RANK, roleLabel, type Role, type WorkspaceMember } from "./roles";

type PendingConfirm =
  | { kind: "remove"; member: WorkspaceMember }
  | { kind: "demote-self"; member: WorkspaceMember; role: Role };

export function MembersTable({
  organizationId,
  workspaceName,
  members,
  currentUserId,
  canManage,
}: {
  organizationId: string;
  workspaceName: string;
  members: WorkspaceMember[];
  currentUserId: string;
  canManage: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busyMemberId, setBusyMemberId] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<PendingConfirm | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const ownerCount = members.filter((m) => m.role === "owner").length;

  function ask(next: PendingConfirm) {
    setConfirm(next);
    setConfirmOpen(true);
  }

  async function changeRole(memberId: string, role: Role): Promise<string | void> {
    setBusyMemberId(memberId);
    setError(null);
    const { error: updateError } = await authClient.organization.updateMemberRole({
      memberId,
      role,
      organizationId,
    });
    setBusyMemberId(null);
    if (updateError) return updateError.message ?? "Couldn't change the role. Try again.";
    router.refresh();
  }

  async function onRoleSelect(m: WorkspaceMember, role: Role) {
    if (role === m.role) return;
    if (m.userId === currentUserId && RANK[role] < RANK[m.role]) {
      ask({ kind: "demote-self", member: m, role });
      return;
    }
    const message = await changeRole(m.id, role);
    if (message) setError(message);
  }

  async function removeMember(memberId: string): Promise<string | void> {
    const { error: removeError } = await authClient.organization.removeMember({
      memberIdOrEmail: memberId,
      organizationId,
    });
    if (removeError) return removeError.message ?? "Couldn't remove this member. Try again.";
    router.refresh();
  }

  const confirmProps = (() => {
    if (!confirm) return null;
    if (confirm.kind === "remove") {
      return {
        title: `Remove ${confirm.member.email}?`,
        description: `They lose access to ${workspaceName} and its receipts. You can invite them again later.`,
        confirmLabel: "Remove member",
        cancelLabel: "Keep",
        destructive: true,
        onConfirm: () => removeMember(confirm.member.id),
      };
    }
    const label = roleLabel(confirm.role);
    return {
      title: `Change your role to ${label}?`,
      description:
        confirm.role === "member"
          ? `You won't be able to invite or remove members in ${workspaceName}. Only an owner or admin can change it back.`
          : `You won't be able to manage owners in ${workspaceName}. Only an owner can change it back.`,
      confirmLabel: `Become ${label.toLowerCase()}`,
      cancelLabel: "Keep my role",
      destructive: true,
      onConfirm: () => changeRole(confirm.member.id, confirm.role),
    };
  })();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Users aria-hidden="true" className="size-5 text-primary" />
          Members
        </CardTitle>
        <CardDescription>People with access to {workspaceName}.</CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        {error ? (
          <Alert className="mx-5 mb-4 w-auto" variant="destructive">
            {error}
          </Alert>
        ) : null}
        <ul className="divide-y divide-border border-t border-border">
          {members.map((m) => {
            const isSelf = m.userId === currentUserId;
            const isLastOwner = m.role === "owner" && ownerCount <= 1;
            const busy = busyMemberId === m.id;
            const editable = canManage && !isLastOwner;
            return (
              <li className="flex flex-wrap items-center gap-x-3 gap-y-2 px-5 py-3.5" key={m.id}>
                <div className="flex min-w-48 flex-1 items-center gap-3">
                  <span
                    aria-hidden="true"
                    className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/15 font-mono text-sm font-semibold text-primary"
                  >
                    {(m.name.trim() || m.email || "?").charAt(0).toUpperCase()}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {m.name || m.email}
                      {isSelf ? (
                        <span className="ml-2 text-xs font-normal text-muted-foreground">
                          (you)
                        </span>
                      ) : null}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">{m.email}</p>
                  </div>
                </div>
                <div className="ml-11 flex items-center gap-2 sm:ml-0">
                  {busy ? (
                    <Loader2
                      aria-label="Saving"
                      className="size-4 animate-spin text-muted-foreground"
                    />
                  ) : null}
                  {editable ? (
                    <RoleSelect
                      ariaLabel={`Role for ${m.email}`}
                      disabled={busy}
                      onChange={(role) => void onRoleSelect(m, role)}
                      value={m.role}
                    />
                  ) : (
                    <Badge variant={m.role === "owner" ? "default" : "secondary"}>
                      {roleLabel(m.role)}
                    </Badge>
                  )}
                  {canManage && !isSelf && !isLastOwner ? (
                    <Button
                      aria-label={`Remove ${m.email}`}
                      disabled={busy}
                      onClick={() => ask({ kind: "remove", member: m })}
                      size="icon-sm"
                      variant="ghost"
                    >
                      <Trash2 aria-hidden="true" />
                    </Button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      </CardContent>
      {confirmProps ? (
        <ConfirmDialog onOpenChange={setConfirmOpen} open={confirmOpen} {...confirmProps} />
      ) : null}
    </Card>
  );
}
