"use client";

import { Button, buttonVariants } from "@receipt-ocr/ui/components/button";
import { cn } from "@receipt-ocr/ui/lib/utils";
import { ArrowLeft, Link2Off, Loader2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { authErrorMessage } from "@/lib/auth-errors";
import { authClient } from "@/lib/auth-client";
import { AuthError, AuthHeading, AuthMessage, authCardClass, authLinkClass } from "./auth-field";
import { FocusHeading } from "./focus-heading";
import { PasswordField } from "./password-field";

function InvalidLink() {
  return (
    <AuthMessage
      actions={
        <>
          <Link className={cn(buttonVariants(), "h-11 w-full")} href="/forgot-password">
            Request a new link
          </Link>
          <Link className={cn(buttonVariants({ variant: "ghost" }), "h-11 w-full")} href="/sign-in">
            Back to sign in
          </Link>
        </>
      }
      icon={Link2Off}
      title="This reset link can't be used"
      tone="warning"
    >
      <p>Reset links expire after 1 hour and work only once. Request a new link to continue.</p>
    </AuthMessage>
  );
}

export function ResetPasswordForm({ token }: { token: string | null }) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mismatch, setMismatch] = useState(false);
  const [tokenRejected, setTokenRejected] = useState(false);

  if (!token) return <InvalidLink />;
  if (tokenRejected) {
    return (
      <FocusHeading>
        <InvalidLink />
      </FocusHeading>
    );
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (password !== confirm) {
      setMismatch(true);
      setError("The two passwords are different. Type the same password in both fields.");
      return;
    }
    setMismatch(false);
    setPending(true);
    setError(null);
    const { error: resetError } = await authClient.resetPassword({
      newPassword: password,
      token: token ?? undefined,
    });
    if (resetError) {
      setPending(false);
      if (resetError.code === "INVALID_TOKEN" || resetError.code === "TOKEN_EXPIRED") {
        setTokenRejected(true);
        return;
      }
      setError(authErrorMessage(resetError));
      return;
    }
    // Other sessions were revoked server-side; the sign-in page confirms the change.
    router.push("/sign-in?reset=1");
    router.refresh();
  }

  return (
    <div className={authCardClass}>
      <AuthHeading title="Choose a new password">
        After you save it, you are signed out on every other device.
      </AuthHeading>
      <form className="mt-6 flex flex-col gap-4" onSubmit={handleSubmit}>
        <PasswordField
          autoComplete="new-password"
          id="reset-password"
          label="New password"
          maxLength={128}
          minLength={8}
          onChange={(event) => setPassword(event.target.value)}
          required
          value={password}
        />
        <PasswordField
          aria-invalid={mismatch || undefined}
          autoComplete="new-password"
          id="reset-confirm"
          label="Confirm new password"
          maxLength={128}
          onChange={(event) => {
            setConfirm(event.target.value);
            if (mismatch) setMismatch(false);
          }}
          required
          value={confirm}
        />
        {error ? <AuthError>{error}</AuthError> : null}
        <Button className="mt-1 h-11 w-full" disabled={pending} type="submit">
          {pending ? (
            <>
              <Loader2 aria-hidden className="size-4 animate-spin" />
              Saving password…
            </>
          ) : (
            "Save new password"
          )}
        </Button>
      </form>
      <p className="mt-6 border-t border-border pt-5 text-center text-sm">
        <Link
          className={cn(
            authLinkClass,
            "inline-flex min-h-11 items-center gap-1.5 font-normal text-muted-foreground hover:text-foreground",
          )}
          href="/sign-in"
        >
          <ArrowLeft aria-hidden className="size-3.5" />
          Back to sign in
        </Link>
      </p>
    </div>
  );
}
