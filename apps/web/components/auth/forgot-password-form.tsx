"use client";

import { Button, buttonVariants } from "@receipt-ocr/ui/components/button";
import { cn } from "@receipt-ocr/ui/lib/utils";
import { ArrowLeft, Loader2, MailCheck } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { authErrorMessage } from "@/lib/auth-errors";
import { authClient } from "@/lib/auth-client";
import {
  AuthError,
  AuthHeading,
  AuthMessage,
  EmailField,
  authCardClass,
  authLinkClass,
} from "./auth-field";
import { FocusHeading } from "./focus-heading";

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const { error: resetError } = await authClient.requestPasswordReset({
      email: email.trim(),
      redirectTo: "/reset-password",
    });
    setPending(false);
    if (resetError) {
      setError(authErrorMessage(resetError));
      return;
    }
    // Same confirmation whether or not the address exists, so the form can't reveal accounts.
    setSent(true);
  }

  if (sent) {
    return (
      <FocusHeading>
        <AuthMessage
          actions={
            <>
              <Link className={cn(buttonVariants(), "h-11 w-full")} href="/sign-in">
                <ArrowLeft aria-hidden className="size-4" />
                Back to sign in
              </Link>
              <Button className="h-11 w-full" onClick={() => setSent(false)} variant="ghost">
                Use a different email
              </Button>
            </>
          }
          icon={MailCheck}
          title="Check your email"
        >
          <p role="status">
            If an account exists for{" "}
            <span className="break-all font-medium text-foreground">{email.trim()}</span>, we sent
            it a link to reset the password.
          </p>
          <p>
            The link expires in 1 hour. If you can&apos;t find the email, check your spam folder.
          </p>
        </AuthMessage>
      </FocusHeading>
    );
  }

  return (
    <div className={authCardClass}>
      <AuthHeading title="Reset your password">
        Enter the email you use for receiptOCR and we&apos;ll send you a link to choose a new
        password.
      </AuthHeading>
      <form className="mt-6 flex flex-col gap-4" onSubmit={handleSubmit}>
        <EmailField
          id="forgot-email"
          label="Email"
          onChange={(event) => setEmail(event.target.value)}
          placeholder="name@example.com"
          required
          value={email}
        />
        {error ? <AuthError>{error}</AuthError> : null}
        <Button className="mt-1 h-11 w-full" disabled={pending} type="submit">
          {pending ? (
            <>
              <Loader2 aria-hidden className="size-4 animate-spin" />
              Sending link…
            </>
          ) : (
            "Send reset link"
          )}
        </Button>
      </form>
      <p className="mt-6 border-t border-border pt-5 text-center text-sm text-muted-foreground">
        Remember your password?{" "}
        <Link
          className={cn(authLinkClass, "inline-flex min-h-11 min-w-11 items-center justify-center")}
          href="/sign-in"
        >
          Sign in
        </Link>
      </p>
    </div>
  );
}
