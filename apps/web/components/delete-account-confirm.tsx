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

const LINK_INVALID =
  "This link has expired or was already used. Request a new one from Settings to delete your account.";

/** Posts the emailed token back to Better Auth's /delete-user, which consumes it and deletes. */
export function DeleteAccountConfirm({ token }: { token: string | null }) {
  const [pending, setPending] = useState(false);
  const [deleted, setDeleted] = useState(false);
  const [spent, setSpent] = useState(false);
  const [error, setError] = useState<string | null>(token ? null : LINK_INVALID);

  async function confirm() {
    if (!token) return;
    setPending(true);
    setError(null);
    const { error: deleteError } = await authClient.deleteUser({ token });
    setPending(false);
    if (deleteError) {
      // The token is used up even when the deletion is then refused (a shared workspace).
      if (deleteError.status === 429) {
        setError(authErrorMessage(deleteError));
        return;
      }
      setSpent(true);
      setError(
        deleteError.code === "INVALID_TOKEN"
          ? LINK_INVALID
          : `${authErrorMessage(deleteError)} Then request a new link from Settings.`,
      );
      return;
    }
    clearSignedInHint();
    await clearSharedFiles();
    setDeleted(true);
  }

  if (deleted) {
    return (
      <Card>
        <CardContent className="flex flex-col gap-3 pt-5">
          <p className="text-sm" role="status">
            Your account, your workspaces and their receipts are deleted.
          </p>
          <div>
            <Link className={buttonVariants({ variant: "outline" })} href="/">
              Go to the home page
            </Link>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-destructive/30">
      <CardContent className="flex flex-col gap-3 pt-5">
        <p className="text-sm text-muted-foreground">
          This permanently removes your account, your workspaces and every receipt in them. You
          can&apos;t undo this.
        </p>
        {error ? <Alert variant="destructive">{error}</Alert> : null}
        <div className="flex flex-wrap gap-2">
          {token && !spent ? (
            <Button disabled={pending} onClick={confirm} variant="destructive">
              {pending ? (
                <Loader2 aria-hidden="true" className="animate-spin motion-reduce:animate-none" />
              ) : (
                <Trash2 aria-hidden="true" />
              )}
              Delete my account
            </Button>
          ) : null}
          <Link className={buttonVariants({ variant: "outline" })} href="/app/settings">
            {token && !spent ? "Keep my account" : "Back to Settings"}
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}
