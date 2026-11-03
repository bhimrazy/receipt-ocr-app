"use client";

import { Button } from "@receipt-ocr/ui/components/button";
import { Input } from "@receipt-ocr/ui/components/input";
import { ArrowLeft, Loader2, MailCheck } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { authClient } from "@/lib/auth-client";

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
      setError(resetError.message ?? "Something went wrong. Please try again.");
      return;
    }
    // Always the same confirmation, whether or not the address exists —
    // otherwise this form becomes an account-enumeration oracle.
    setSent(true);
  }

  if (sent) {
    return (
      <div className="w-full rounded-2xl border border-white/10 bg-card/80 p-8 text-center shadow-2xl backdrop-blur-xl">
        <span className="mx-auto mb-4 flex size-11 items-center justify-center rounded-full border border-primary/20 bg-primary/10 text-primary">
          <MailCheck className="size-5" />
        </span>
        <h2 className="text-2xl font-semibold tracking-tight">Check your email</h2>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          If an account exists for <span className="text-foreground">{email}</span>, a reset link is
          on its way. It expires in one hour.
        </p>
        <Button asChild className="mt-6 w-full" variant="outline">
          <Link href="/sign-in">
            <ArrowLeft className="size-4" />
            Back to sign in
          </Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="w-full rounded-2xl border border-white/10 bg-card/80 p-8 shadow-2xl backdrop-blur-xl">
      <h2 className="text-2xl font-semibold tracking-tight">Reset your password</h2>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">
        Enter the email you signed up with and we&apos;ll send you a reset link.
      </p>
      <form className="mt-6 flex flex-col gap-3" onSubmit={handleSubmit}>
        <Input
          aria-label="Email"
          autoComplete="email"
          onChange={(event) => setEmail(event.target.value)}
          placeholder="you@example.com"
          required
          type="email"
          value={email}
        />
        {error ? (
          <p
            className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400"
            role="alert"
          >
            {error}
          </p>
        ) : null}
        <Button className="mt-1 w-full" disabled={pending || !email.trim()} type="submit">
          {pending ? <Loader2 className="size-4 animate-spin" /> : null}
          Send reset link
        </Button>
      </form>
      <p className="mt-6 text-center text-sm text-muted-foreground">
        Remembered it?{" "}
        <Link className="text-primary hover:underline" href="/sign-in">
          Sign in
        </Link>
      </p>
    </div>
  );
}
