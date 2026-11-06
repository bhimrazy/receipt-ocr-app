"use client";

import { Button } from "@receipt-ocr/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@receipt-ocr/ui/components/card";
import { ConfirmDialog } from "@receipt-ocr/ui/components/confirm-dialog";
import { Check, Copy } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { authClient } from "@/lib/auth-client";
import { formatDate } from "@/lib/format";
import { inviteUrl, useCopyLink } from "./role-select";
import { roleLabel, type WorkspaceInvitation } from "./roles";

export function PendingInvites({ invitations }: { invitations: WorkspaceInvitation[] }) {
  const router = useRouter();
  const { copiedKey, copy } = useCopyLink();
  const [cancelling, setCancelling] = useState<WorkspaceInvitation | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  async function cancelInvite(invitationId: string): Promise<string | void> {
    const { error } = await authClient.organization.cancelInvitation({ invitationId });
    if (error) return error.message ?? "Couldn't cancel the invite. Try again.";
    router.refresh();
  }

  if (invitations.length === 0) return null;

  return (
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
                  <Button
                    onClick={() => copy(inv.id, inviteUrl(inv.id))}
                    size="sm"
                    variant="outline"
                  >
                    {copiedKey === inv.id ? (
                      <Check aria-hidden="true" />
                    ) : (
                      <Copy aria-hidden="true" />
                    )}
                    {copiedKey === inv.id ? "Copied" : "Copy link"}
                  </Button>
                  <Button
                    onClick={() => {
                      setCancelling(inv);
                      setConfirmOpen(true);
                    }}
                    size="sm"
                    variant="ghost"
                  >
                    Cancel invite
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      </CardContent>
      {cancelling ? (
        <ConfirmDialog
          cancelLabel="Keep invite"
          confirmLabel="Cancel invite"
          description="Their invite link stops working. You can invite them again later."
          destructive
          onConfirm={() => cancelInvite(cancelling.id)}
          onOpenChange={setConfirmOpen}
          open={confirmOpen}
          title={`Cancel the invite for ${cancelling.email}?`}
        />
      ) : null}
    </Card>
  );
}
