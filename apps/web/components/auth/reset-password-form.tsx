"use client";

import { Button, buttonVariants } from "@receipt-ocr/ui/components/button";
import { cn } from "@receipt-ocr/ui/lib/utils";
import { ArrowLeft, Loader2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { authClient } from "@/lib/auth-client";
import { AuthError, AuthField, authCardClass, authLinkClass } from "./auth-field";

export function ResetPasswordForm({ token }: { token: string | null }) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!token) {
    return (
      <div className={cn(authCardClass, "text-center")}>
        <h1 className="text-2xl font-semibold tracking-tight">This link isn&apos;t valid</h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          Reset links expire after an hour and work only once. Request a new one to continue.
        </p>
        <Link className={cn(buttonVariants(), "mt-6 h-11 w-full")} href="/forgot-password">
          Request a new link
        </Link>
      </div>
    );
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (password !== confirm) {
      setError("Those passwords don't match.");
      return;
    }
    setPending(true);
    setError(null);
    const { error: resetError } = await authClient.resetPassword({
      newPassword: password,
      token: token ?? undefined,
    });
    setPending(false);
    if (resetError) {
      setError(resetError.message ?? "We couldn't reset your password. The link may have expired.");
      return;
    }
    // Other sessions were revoked server-side; the sign-in page confirms the change.
    router.push("/sign-in?reset=1");
    router.refresh();
  }

  return (
    <div className={authCardClass}>
      <h1 className="text-2xl font-semibold tracking-tight">Choose a new password</h1>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">
        Setting a new password signs you out on every other device.
      </p>
      <form className="mt-6 flex flex-col gap-4" onSubmit={handleSubmit}>
        <AuthField
          autoComplete="new-password"
          hint="At least 8 characters."
          id="reset-password"
          label="New password"
          minLength={8}
          onChange={(event) => setPassword(event.target.value)}
          required
          type="password"
          value={password}
        />
        <AuthField
          autoComplete="new-password"
          id="reset-confirm"
          label="Confirm new password"
          minLength={8}
          onChange={(event) => setConfirm(event.target.value)}
          required
          type="password"
          value={confirm}
        />
        {error ? <AuthError>{error}</AuthError> : null}
        <Button className="mt-1 h-11 w-full" disabled={pending} type="submit">
          {pending ? <Loader2 aria-hidden className="size-4 animate-spin" /> : null}
          Set new password
        </Button>
      </form>
      <p className="mt-6 text-center text-sm">
        <Link
          className={cn(
            authLinkClass,
            "inline-flex items-center gap-1 text-muted-foreground hover:text-foreground",
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
