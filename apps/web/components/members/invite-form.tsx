"use client";

import { Alert } from "@receipt-ocr/ui/components/alert";
import { Button } from "@receipt-ocr/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@receipt-ocr/ui/components/card";
import { Field, FieldLabel } from "@receipt-ocr/ui/components/field";
import { Input } from "@receipt-ocr/ui/components/input";
import { Check, Copy, Loader2, Mail } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { withStepUp } from "@/components/step-up/step-up";
import { authClient } from "@/lib/auth-client";
import { RoleSelect, inviteUrl, useCopyLink } from "./role-select";
import type { Role } from "./roles";

/** Members against the plan's limit, pending invitations included. The server enforces it too. */
export type MemberRoom = {
  plan: "free" | "pro";
  used: number;
  limit: number;
  /** Only an owner can upgrade the workspace. */
  canUpgrade: boolean;
};

export function InviteForm({ organizationId, room }: { organizationId: string; room: MemberRoom }) {
  const full = room.used >= room.limit;
  const planName = room.plan === "pro" ? "Pro" : "Free";
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("member");
  const [inviting, setInviting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const { copiedKey, copy } = useCopyLink();

  async function handleInvite(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLink(null);
    const trimmed = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setError("Enter an email address, like name@example.com.");
      return;
    }
    setError(null);
    setInviting(true);
    const { data, error: inviteError } = await withStepUp(
      () => authClient.organization.inviteMember({ email: trimmed, role, organizationId }),
      "workspace.transfer_ownership",
    );
    setInviting(false);
    if (inviteError || !data) {
      setError(inviteError?.message ?? "Couldn't send the invite. Try again.");
      return;
    }
    setLink(inviteUrl(data.id));
    setEmail("");
    router.refresh();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Mail aria-hidden="true" className="size-5 text-primary" />
          Invite a member
        </CardTitle>
        <CardDescription>
          We&apos;ll email them an invite. You can also copy the link and send it yourself.
        </CardDescription>
        <p className="text-sm text-muted-foreground">
          <span className="font-medium tabular-nums text-foreground">
            {room.used} of {room.limit}
          </span>{" "}
          members on {planName}, counting pending invites.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <form
          className="flex flex-col gap-3 sm:flex-row sm:items-end"
          noValidate
          onSubmit={handleInvite}
        >
          <Field className="flex-1" data-invalid={error ? true : undefined}>
            <FieldLabel htmlFor="invite-email">Email</FieldLabel>
            <Input
              aria-describedby={error ? "invite-error" : undefined}
              aria-invalid={error ? true : undefined}
              autoComplete="off"
              id="invite-email"
              onChange={(e) => setEmail(e.target.value)}
              placeholder="teammate@example.com"
              type="email"
              value={email}
            />
          </Field>
          <Field className="sm:w-32">
            <FieldLabel htmlFor="invite-role">Role</FieldLabel>
            <RoleSelect id="invite-role" onChange={setRole} value={role} />
          </Field>
          <Button disabled={inviting || full} type="submit">
            {inviting ? (
              <Loader2 aria-hidden="true" className="animate-spin motion-reduce:animate-none" />
            ) : null}
            Send invite
          </Button>
        </form>
        {full ? (
          <Alert>
            <p>
              {room.plan === "pro" ? (
                <>
                  This workspace has reached Pro&apos;s {room.limit} members. Cancel a pending
                  invite or remove a member to invite someone else.
                </>
              ) : room.canUpgrade ? (
                <>
                  Free workspaces have up to {room.limit} members. Cancel a pending invite, remove a
                  member, or{" "}
                  <Link
                    className="text-foreground underline underline-offset-4"
                    href="/app/settings/billing"
                  >
                    upgrade to Pro
                  </Link>{" "}
                  for more.
                </>
              ) : (
                <>
                  Free workspaces have up to {room.limit} members. Ask the owner to upgrade this
                  workspace to Pro, or cancel a pending invite.
                </>
              )}
            </p>
          </Alert>
        ) : null}
        {error ? (
          <Alert id="invite-error" variant="destructive">
            {error}
          </Alert>
        ) : null}
        {link ? (
          <Alert className="p-3" variant="success">
            <Check aria-hidden="true" />
            <p>Invite sent. Or share this link:</p>
            <div className="mt-2 flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded bg-secondary px-2 py-1.5 font-mono text-xs">
                {link}
              </code>
              <Button onClick={() => copy("new", link)} size="sm" variant="outline">
                {copiedKey === "new" ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
                {copiedKey === "new" ? "Copied" : "Copy link"}
              </Button>
            </div>
          </Alert>
        ) : null}
      </CardContent>
    </Card>
  );
}
