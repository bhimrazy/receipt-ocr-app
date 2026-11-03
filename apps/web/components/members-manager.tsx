"use client";

import { Badge } from "@receipt-ocr/ui/components/badge";
import { Button } from "@receipt-ocr/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@receipt-ocr/ui/components/card";
import { Input } from "@receipt-ocr/ui/components/input";
import { Check, Copy, Loader2, Mail, Trash2, Users } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { authClient } from "@/lib/auth-client";

type Role = "owner" | "admin" | "member";
const ASSIGNABLE_ROLES: Role[] = ["member", "admin", "owner"];

type FullOrganization = Awaited<
  ReturnType<typeof authClient.organization.getFullOrganization>
>["data"];
type OrgMember = NonNullable<FullOrganization>["members"][number];
type OrgInvitation = NonNullable<FullOrganization>["invitations"][number];

function roleBadgeVariant(role: string) {
  if (role === "owner") return "default" as const;
  if (role === "admin") return "secondary" as const;
  return "secondary" as const;
}

export function MembersManager() {
  const { data: activeOrg } = authClient.useActiveOrganization();
  const { data: session } = authClient.useSession();

  const [org, setOrg] = useState<FullOrganization>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyMemberId, setBusyMemberId] = useState<string | null>(null);
  const [busyInviteId, setBusyInviteId] = useState<string | null>(null);

  // Invite form
  const [email, setEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<Role>("member");
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const activeOrgId = activeOrg?.id;

  const load = useCallback(async () => {
    setError(null);
    const { data, error: loadError } = await authClient.organization.getFullOrganization();
    if (loadError) {
      setError(loadError.message ?? "Could not load workspace members.");
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
  const invitations: OrgInvitation[] = (org?.invitations ?? []).filter(
    (i: OrgInvitation) => i.status === "pending",
  );
  const currentUserId = session?.user.id;
  const currentMember = members.find((m) => m.userId === currentUserId);
  const currentRole = currentMember?.role ?? "member";
  const canManage = currentRole === "owner" || currentRole === "admin";
  const ownerCount = members.filter((m) => m.role === "owner").length;

  async function handleRoleChange(memberId: string, role: Role) {
    setBusyMemberId(memberId);
    setError(null);
    const { error: updateError } = await authClient.organization.updateMemberRole({
      memberId,
      role,
    });
    setBusyMemberId(null);
    if (updateError) {
      setError(updateError.message ?? "Could not update role.");
      return;
    }
    await load();
  }

  async function handleRemove(memberId: string) {
    setBusyMemberId(memberId);
    setError(null);
    const { error: removeError } = await authClient.organization.removeMember({
      memberIdOrEmail: memberId,
    });
    setBusyMemberId(null);
    if (removeError) {
      setError(removeError.message ?? "Could not remove member.");
      return;
    }
    await load();
  }

  async function handleInvite(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setInviteError(null);
    setInviteLink(null);
    setCopied(false);
    setInviting(true);
    const { data, error: inviteErr } = await authClient.organization.inviteMember({
      email: email.trim(),
      role: inviteRole,
    });
    setInviting(false);
    if (inviteErr || !data) {
      setInviteError(inviteErr?.message ?? "Could not send invitation.");
      return;
    }
    // No email provider yet: surface a shareable accept link so invites are testable.
    setInviteLink(`${window.location.origin}/accept-invitation/${data.id}`);
    setEmail("");
    await load();
  }

  async function handleCancelInvite(invitationId: string) {
    setBusyInviteId(invitationId);
    setError(null);
    const { error: cancelError } = await authClient.organization.cancelInvitation({ invitationId });
    setBusyInviteId(null);
    if (cancelError) {
      setError(cancelError.message ?? "Could not cancel invitation.");
      return;
    }
    await load();
  }

  async function copyLink(link: string) {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Loading members…
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="size-5 text-primary" />
            Members
          </CardTitle>
          <CardDescription>
            {org?.name
              ? `People with access to ${org.name}.`
              : "People with access to this workspace."}
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {error ? (
            <p
              className="mx-5 mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400"
              role="alert"
            >
              {error}
            </p>
          ) : null}
          <ul className="divide-y divide-border border-t border-border">
            {members.map((m) => {
              const isSelf = m.userId === currentUserId;
              const isLastOwner = m.role === "owner" && ownerCount <= 1;
              const busy = busyMemberId === m.id;
              const editable = canManage && !isLastOwner;
              return (
                <li className="flex flex-wrap items-center gap-3 px-5 py-3.5" key={m.id}>
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/15 font-mono text-sm font-semibold text-primary">
                    {(m.user?.name?.trim() || m.user?.email || "?").charAt(0).toUpperCase()}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {m.user?.name || m.user?.email}
                      {isSelf ? (
                        <span className="ml-2 text-xs text-muted-foreground">(you)</span>
                      ) : null}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">{m.user?.email}</p>
                  </div>
                  {editable ? (
                    <select
                      aria-label={`Role for ${m.user?.email}`}
                      className="h-8 rounded-lg border border-border bg-background/60 px-2 text-xs text-foreground outline-none transition focus:border-primary disabled:opacity-50"
                      disabled={busy}
                      onChange={(e) => handleRoleChange(m.id, e.target.value as Role)}
                      value={m.role}
                    >
                      {ASSIGNABLE_ROLES.map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <Badge variant={roleBadgeVariant(m.role)}>{m.role}</Badge>
                  )}
                  {canManage && !isSelf && !isLastOwner ? (
                    <Button
                      aria-label={`Remove ${m.user?.email}`}
                      disabled={busy}
                      onClick={() => handleRemove(m.id)}
                      size="sm"
                      variant="ghost"
                    >
                      {busy ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <Trash2 className="size-4" />
                      )}
                    </Button>
                  ) : null}
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
              <Mail className="size-5 text-primary" />
              Invite a member
            </CardTitle>
            <CardDescription>
              Send an invite by email. Until email delivery is wired up, share the generated link
              below.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <form className="flex flex-col gap-3 sm:flex-row" onSubmit={handleInvite}>
              <Input
                aria-label="Invitee email"
                className="flex-1"
                onChange={(e) => setEmail(e.target.value)}
                placeholder="teammate@example.com"
                required
                type="email"
                value={email}
              />
              <select
                aria-label="Invitee role"
                className="h-10 rounded-lg border border-border bg-background/60 px-3 text-sm text-foreground outline-none transition focus:border-primary"
                onChange={(e) => setInviteRole(e.target.value as Role)}
                value={inviteRole}
              >
                <option value="member">member</option>
                <option value="admin">admin</option>
                <option value="owner">owner</option>
              </select>
              <Button disabled={inviting || !email.trim()} type="submit">
                {inviting ? <Loader2 className="size-4 animate-spin" /> : null}
                Invite
              </Button>
            </form>
            {inviteError ? (
              <p
                className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400"
                role="alert"
              >
                {inviteError}
              </p>
            ) : null}
            {inviteLink ? (
              <div className="rounded-lg border border-border bg-background/40 p-3">
                <p className="mb-2 text-xs text-muted-foreground">
                  Shareable invite link (no email sent yet):
                </p>
                <div className="flex items-center gap-2">
                  <code className="min-w-0 flex-1 truncate rounded bg-secondary px-2 py-1.5 font-mono text-xs">
                    {inviteLink}
                  </code>
                  <Button onClick={() => copyLink(inviteLink)} size="sm" variant="outline">
                    {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
                    {copied ? "Copied" : "Copy"}
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
            <CardTitle>Pending invitations</CardTitle>
            <CardDescription>Invitations expire 7 days after they are sent.</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <ul className="divide-y divide-border border-t border-border">
              {invitations.map((inv) => {
                const busy = busyInviteId === inv.id;
                return (
                  <li className="flex flex-wrap items-center gap-3 px-5 py-3.5" key={inv.id}>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{inv.email}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {inv.role ?? "member"} · /accept-invitation/{inv.id}
                      </p>
                    </div>
                    <Button
                      onClick={() =>
                        copyLink(`${window.location.origin}/accept-invitation/${inv.id}`)
                      }
                      size="sm"
                      variant="outline"
                    >
                      <Copy className="size-4" />
                      Copy link
                    </Button>
                    <Button
                      disabled={busy}
                      onClick={() => handleCancelInvite(inv.id)}
                      size="sm"
                      variant="ghost"
                    >
                      {busy ? <Loader2 className="size-4 animate-spin" /> : "Cancel"}
                    </Button>
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
