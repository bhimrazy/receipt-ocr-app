"use client";

import { Alert } from "@receipt-ocr/ui/components/alert";
import { Button, buttonVariants } from "@receipt-ocr/ui/components/button";
import { Card, CardContent } from "@receipt-ocr/ui/components/card";
import { Loader2, Trash2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { authErrorMessage } from "@/lib/auth-errors";
import { authClient } from "@/lib/auth-client";
import { clearSharedFiles } from "@/lib/share-target";
import { clearSignedInHint } from "@/lib/signed-in-hint";
import { WORKSPACE_NEEDS_OWNER } from "@/lib/step-up";

const LINK_INVALID = "This link has expired or was already used.";

/** Opens the delete dialog in Settings again (`?resume=` is read by account-settings.tsx). */
const REQUEST_AGAIN = "/app/settings?resume=delete-account";

/** Posts the emailed token back to Better Auth's /delete-user, which consumes it and deletes. */
export function DeleteAccountConfirm({ token }: { token: string | null }) {
  const [pending, setPending] = useState(false);
  // The token is spent once tried, even when the deletion is then refused.
  const [spent, setSpent] = useState<string | null>(token ? null : LINK_INVALID);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    if (!token) return;
    setPending(true);
    setError(null);
    const { error: deleteError } = await authClient.deleteUser({ token });
    if (deleteError) {
      setPending(false);
      // Rate limits and a workspace that still needs another owner leave the link usable.
      if (deleteError.status === 429 || deleteError.code === WORKSPACE_NEEDS_OWNER)
        setError(authErrorMessage(deleteError));
      else
        setSpent(
          deleteError.code === "INVALID_TOKEN" ? LINK_INVALID : authErrorMessage(deleteError),
        );
      return;
    }
    clearSignedInHint();
    await clearSharedFiles();
    // A full load: Better Auth cleared the session cookie, so nothing of the signed-in shell stays.
    window.location.replace("/account-deleted");
  }

  if (spent) {
    return (
      <div className="flex flex-col gap-3">
        <Alert variant="destructive">{spent}</Alert>
        <div>
          <Link className={buttonVariants({ variant: "outline" })} href={REQUEST_AGAIN}>
            Request a new link
          </Link>
        </div>
      </div>
    );
  }

  return (
    <Card className="border-destructive/30">
      <CardContent className="flex flex-col gap-3 pt-5">
        <p className="text-sm text-muted-foreground">
          This permanently removes your account and any workspace only you belong to, with every
          receipt in it. Receipts you uploaded to shared workspaces stay there. You can&apos;t undo
          this.
        </p>
        {error ? <Alert variant="destructive">{error}</Alert> : null}
        <div className="flex flex-wrap gap-2">
          <Button disabled={pending} onClick={confirm} variant="destructive">
            {pending ? (
              <Loader2 aria-hidden="true" className="animate-spin motion-reduce:animate-none" />
            ) : (
              <Trash2 aria-hidden="true" />
            )}
            Delete my account
          </Button>
          <Link className={buttonVariants({ variant: "outline" })} href="/app/settings">
            Keep my account
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}
