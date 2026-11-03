"use client";

import { Button, buttonVariants } from "@receipt-ocr/ui/components/button";
import { cn } from "@receipt-ocr/ui/lib/utils";
import { ArrowLeft, Loader2, MailCheck } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { authClient } from "@/lib/auth-client";
import { AuthError, AuthField, authCardClass, authLinkClass } from "./auth-field";

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
      setError(resetError.message ?? "We couldn't send the link. Try again in a moment.");
      return;
    }
    // Same confirmation whether or not the address exists, so the form can't reveal accounts.
    setSent(true);
  }

  if (sent) {
    return (
      <div className={cn(authCardClass, "text-center")}>
        <span className="mx-auto mb-4 flex size-11 items-center justify-center rounded-full bg-primary/10 text-primary ring-1 ring-inset ring-primary/20">
          <MailCheck aria-hidden className="size-5" />
        </span>
        <h1 className="text-2xl font-semibold tracking-tight">Check your email</h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground" role="status">
          If an account exists for <span className="text-foreground">{email}</span>, a reset link is
          on its way. It expires in one hour.
        </p>
        <Link
          className={cn(buttonVariants({ variant: "outline" }), "mt-6 h-11 w-full")}
          href="/sign-in"
        >
          <ArrowLeft aria-hidden className="size-4" />
          Back to sign in
        </Link>
      </div>
    );
  }

  return (
    <div className={authCardClass}>
      <h1 className="text-2xl font-semibold tracking-tight">Reset your password</h1>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">
        Enter the email you signed up with and we&apos;ll send you a reset link.
      </p>
      <form className="mt-6 flex flex-col gap-4" onSubmit={handleSubmit}>
        <AuthField
          autoComplete="email"
          id="forgot-email"
          label="Email"
          onChange={(event) => setEmail(event.target.value)}
          placeholder="you@example.com"
          required
          type="email"
          value={email}
        />
        {error ? <AuthError>{error}</AuthError> : null}
        <Button className="mt-1 h-11 w-full" disabled={pending || !email.trim()} type="submit">
          {pending ? <Loader2 aria-hidden className="size-4 animate-spin" /> : null}
          Send reset link
        </Button>
      </form>
      <p className="mt-6 text-center text-sm text-muted-foreground">
        Remembered it?{" "}
        <Link className={authLinkClass} href="/sign-in">
          Sign in
        </Link>
      </p>
    </div>
  );
}
