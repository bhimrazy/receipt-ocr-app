"use client";

import { Badge } from "@receipt-ocr/ui/components/badge";
import { Button } from "@receipt-ocr/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@receipt-ocr/ui/components/card";
import { ConfirmDialog } from "@receipt-ocr/ui/components/confirm-dialog";
import { Input } from "@receipt-ocr/ui/components/input";
import { Label } from "@receipt-ocr/ui/components/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@receipt-ocr/ui/components/select";
import { Skeleton } from "@receipt-ocr/ui/components/skeleton";
import { Check, Copy, Loader2, Mail, Trash2, Users } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { authClient } from "@/lib/auth-client";
import { formatDate } from "@/lib/format";

type Role = "owner" | "admin" | "member";

const ROLES: { value: Role; label: string; description: string }[] = [
  { value: "member", label: "Member", description: "Uploads and views the workspace's receipts." },
  { value: "admin", label: "Admin", description: "Also invites and removes members." },
  { value: "owner", label: "Owner", description: "Full control, including the workspace itself." },
];
const ROLE_ITEMS = ROLES.map(({ value, label }) => ({ value, label }));
const RANK: Record<Role, number> = { member: 0, admin: 1, owner: 2 };

function roleLabel(role: string | null | undefined) {
  return ROLES.find((r) => r.value === role)?.label ?? "Member";
}

type FullOrganization = Awaited<ReturnType<typeof authClient.organization.getFullOrganization>>["data"];
type OrgMember = NonNullable<FullOrganization>["members"][number];
type OrgInvitation = NonNullable<FullOrganization>["invitations"][number];

type PendingConfirm =
  | { kind: "remove"; member: OrgMember }
  | { kind: "demote-self"; member: OrgMember; role: Role }
  | { kind: "cancel-invite"; invitation: OrgInvitation };

function ErrorText({ children, id }: { children: React.ReactNode; id?: string }) {
  return (
    <p
      className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
      id={id}
      role="alert"
    >
      {children}
    </p>
  );
}

function RoleSelect({
  value,
  onChange,
  disabled,
  ariaLabel,
  id,
}: {
  value: Role;
  onChange: (role: Role) => void;
  disabled?: boolean;
  ariaLabel?: string;
  id?: string;
}) {
  return (
    <Select
      disabled={disabled}
      items={ROLE_ITEMS}
      onValueChange={(next) => next && onChange(next as Role)}
      value={value}
    >
      <SelectTrigger aria-label={ariaLabel} className="w-32" id={id}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent align="end" alignItemWithTrigger={false} className="w-72 max-w-[calc(100vw-2rem)]">
        {ROLES.map((role) => (
          <SelectItem key={role.value} value={role.value}>
            <span className="flex flex-col gap-0.5 whitespace-normal">
              <span className="font-medium">{role.label}</span>
              <span className="text-xs text-muted-foreground">{role.description}</span>
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function inviteUrl(id: string) {
  return `${window.location.origin}/accept-invitation/${id}`;
}

export function MembersManager() {
  const { data: activeOrg } = authClient.useActiveOrganization();
  const { data: session } = authClient.useSession();

  const [org, setOrg] = useState<FullOrganization>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyMemberId, setBusyMemberId] = useState<string | null>(null);

  const [email, setEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<Role>("member");
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const [confirm, setConfirm] = useState<PendingConfirm | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const activeOrgId = activeOrg?.id;

  const load = useCallback(async () => {
    setError(null);
    const { data, error: loadError } = await authClient.organization.getFullOrganization();
    if (loadError) {
      setError(loadError.message ?? "Couldn't load workspace members. Refresh to try again.");
      setOrg(null);
    } else {
      setOrg(data);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    setLoading(true);
    void load();
  }, [load, activeOrgId]);

  const members: OrgMember[] = org?.members ?? [];
  const invitations: OrgInvitation[] = (org?.invitations ?? []).filter((i: OrgInvitation) => i.status === "pending");
  const currentUserId = session?.user.id;
  const currentRole = (members.find((m) => m.userId === currentUserId)?.role ?? "member") as Role;
  const canManage = currentRole === "owner" || currentRole === "admin";
  const ownerCount = members.filter((m) => m.role === "owner").length;
  const workspaceName = org?.name ?? "this workspace";

  function ask(next: PendingConfirm) {
    setConfirm(next);
    setConfirmOpen(true);
  }

  async function changeRole(memberId: string, role: Role): Promise<string | void> {
    setBusyMemberId(memberId);
    setError(null);
    const { error: updateError } = await authClient.organization.updateMemberRole({ memberId, role });
    setBusyMemberId(null);
    if (updateError) return updateError.message ?? "Couldn't change the role. Try again.";
    await load();
  }

  async function onRoleSelect(m: OrgMember, role: Role) {
    if (role === m.role) return;
    if (m.userId === currentUserId && RANK[role] < RANK[m.role as Role]) {
      ask({ kind: "demote-self", member: m, role });
      return;
    }
    const message = await changeRole(m.id, role);
    if (message) setError(message);
  }

  async function removeMember(memberId: string): Promise<string | void> {
    const { error: removeError } = await authClient.organization.removeMember({ memberIdOrEmail: memberId });
    if (removeError) return removeError.message ?? "Couldn't remove this member. Try again.";
    await load();
  }

  async function cancelInvite(invitationId: string): Promise<string | void> {
    const { error: cancelError } = await authClient.organization.cancelInvitation({ invitationId });
    if (cancelError) return cancelError.message ?? "Couldn't cancel the invite. Try again.";
    await load();
  }

  async function handleInvite(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setInviteLink(null);
    const trimmed = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setInviteError("Enter an email address, like name@example.com.");
      return;
    }
    setInviteError(null);
    setInviting(true);
    const { data, error: inviteErr } = await authClient.organization.inviteMember({ email: trimmed, role: inviteRole });
    setInviting(false);
    if (inviteErr || !data) {
      setInviteError(inviteErr?.message ?? "Couldn't send the invite. Try again.");
      return;
    }
    setInviteLink(inviteUrl(data.id));
    setEmail("");
    await load();
  }

  async function copy(key: string, link: string) {
    try {
      await navigator.clipboard.writeText(link);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey((current) => (current === key ? null : current)), 2000);
    } catch {
      setCopiedKey(null);
    }
  }

  if (loading) {
    return (
      <Card aria-busy="true" aria-label="Loading members">
        <CardContent className="space-y-3 pt-5">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </CardContent>
      </Card>
    );
  }

  const confirmProps = (() => {
    if (!confirm) return null;
    if (confirm.kind === "remove") {
      const who = confirm.member.user?.email ?? "this member";
      return {
        title: `Remove ${who}?`,
        description: `They lose access to ${workspaceName} and its receipts. You can invite them again later.`,
        confirmLabel: "Remove member",
        cancelLabel: "Keep",
        destructive: true,
        onConfirm: () => removeMember(confirm.member.id),
      };
    }
    if (confirm.kind === "demote-self") {
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
    }
    return {
      title: `Cancel the invite for ${confirm.invitation.email}?`,
      description: "Their invite link stops working. You can invite them again later.",
      confirmLabel: "Cancel invite",
      cancelLabel: "Keep invite",
      destructive: true,
      onConfirm: () => cancelInvite(confirm.invitation.id),
    };
  })();

  return (
    <div className="space-y-5">
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
            <div className="mx-5 mb-4">
              <ErrorText>{error}</ErrorText>
            </div>
          ) : null}
          <ul className="divide-y divide-border border-t border-border">
            {members.map((m) => {
              const isSelf = m.userId === currentUserId;
              const isLastOwner = m.role === "owner" && ownerCount <= 1;
              const busy = busyMemberId === m.id;
              const editable = canManage && !isLastOwner;
              const who = m.user?.email ?? "member";
              return (
                <li className="flex flex-wrap items-center gap-x-3 gap-y-2 px-5 py-3.5" key={m.id}>
                  <div className="flex min-w-48 flex-1 items-center gap-3">
                    <span
                      aria-hidden="true"
                      className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/15 font-mono text-sm font-semibold text-primary"
                    >
                      {(m.user?.name?.trim() || m.user?.email || "?").charAt(0).toUpperCase()}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {m.user?.name || m.user?.email}
                        {isSelf ? <span className="ml-2 text-xs font-normal text-muted-foreground">(you)</span> : null}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">{m.user?.email}</p>
                    </div>
                  </div>
                  <div className="ml-11 flex items-center gap-2 sm:ml-0">
                    {busy ? <Loader2 aria-label="Saving" className="size-4 animate-spin text-muted-foreground" /> : null}
                    {editable ? (
                      <RoleSelect
                        ariaLabel={`Role for ${who}`}
                        disabled={busy}
                        onChange={(role) => void onRoleSelect(m, role)}
                        value={m.role as Role}
                      />
                    ) : (
                      <Badge variant={m.role === "owner" ? "default" : "secondary"}>{roleLabel(m.role)}</Badge>
                    )}
                    {canManage && !isSelf && !isLastOwner ? (
                      <Button
                        aria-label={`Remove ${who}`}
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
      </Card>

      {canManage ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Mail aria-hidden="true" className="size-5 text-primary" />
              Invite a member
            </CardTitle>
            <CardDescription>We&apos;ll email them an invite. You can also copy the link and send it yourself.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <form className="flex flex-col gap-3 sm:flex-row sm:items-end" noValidate onSubmit={handleInvite}>
              <div className="flex flex-1 flex-col gap-1.5">
                <Label htmlFor="invite-email">Email</Label>
                <Input
                  aria-describedby={inviteError ? "invite-error" : undefined}
                  aria-invalid={inviteError ? true : undefined}
                  autoComplete="off"
                  id="invite-email"
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="teammate@example.com"
                  type="email"
                  value={email}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="invite-role">Role</Label>
                <RoleSelect id="invite-role" onChange={setInviteRole} value={inviteRole} />
              </div>
              <Button disabled={inviting} type="submit">
                {inviting ? <Loader2 aria-hidden="true" className="animate-spin" /> : null}
                Send invite
              </Button>
            </form>
            {inviteError ? <ErrorText id="invite-error">{inviteError}</ErrorText> : null}
            {inviteLink ? (
              <div className="rounded-lg border border-border bg-background/40 p-3" role="status">
                <p className="mb-2 flex items-center gap-1.5 text-sm">
                  <Check aria-hidden="true" className="size-4 text-primary" />
                  Invite sent. Or share this link:
                </p>
                <div className="flex items-center gap-2">
                  <code className="min-w-0 flex-1 truncate rounded bg-secondary px-2 py-1.5 font-mono text-xs">
                    {inviteLink}
                  </code>
                  <Button onClick={() => copy("new", inviteLink)} size="sm" variant="outline">
                    {copiedKey === "new" ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
                    {copiedKey === "new" ? "Copied" : "Copy link"}
                  </Button>
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {canManage && invitations.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Pending invites</CardTitle>
            <CardDescription>Invites expire 7 days after they&apos;re sent.</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <ul className="divide-y divide-border border-t border-border">
              {invitations.map((inv) => {
                const expires = formatDate(inv.expiresAt);
                return (
                  <li className="flex flex-wrap items-center gap-x-3 gap-y-2 px-5 py-3.5" key={inv.id}>
                    <div className="min-w-48 flex-1">
                      <p className="truncate text-sm font-medium">{inv.email}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {roleLabel(inv.role)}
                        {expires ? ` · Expires ${expires}` : null}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button onClick={() => copy(inv.id, inviteUrl(inv.id))} size="sm" variant="outline">
                        {copiedKey === inv.id ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
                        {copiedKey === inv.id ? "Copied" : "Copy link"}
                      </Button>
                      <Button onClick={() => ask({ kind: "cancel-invite", invitation: inv })} size="sm" variant="ghost">
                        Cancel invite
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      {confirmProps ? <ConfirmDialog onOpenChange={setConfirmOpen} open={confirmOpen} {...confirmProps} /> : null}
    </div>
  );
}
