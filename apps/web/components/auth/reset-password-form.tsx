"use client";

import { Button } from "@receipt-ocr/ui/components/button";
import { Input } from "@receipt-ocr/ui/components/input";
import { ArrowLeft, Loader2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { authClient } from "@/lib/auth-client";

export function ResetPasswordForm({ token }: { token: string | null }) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!token) {
    return (
      <div className="w-full rounded-2xl border border-white/10 bg-card/80 p-8 text-center shadow-2xl backdrop-blur-xl">
        <h2 className="text-2xl font-semibold tracking-tight">This link isn&apos;t valid</h2>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          Reset links expire after an hour and can only be used once. Request a new one to continue.
        </p>
        <Button asChild className="mt-6 w-full">
          <Link href="/forgot-password">Request a new link</Link>
        </Button>
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
      setError(resetError.message ?? "Couldn't reset your password. The link may have expired.");
      return;
    }
    // Every other session was revoked server-side; sign in fresh.
    router.push("/sign-in");
    router.refresh();
  }

  return (
    <div className="w-full rounded-2xl border border-white/10 bg-card/80 p-8 shadow-2xl backdrop-blur-xl">
      <h2 className="text-2xl font-semibold tracking-tight">Choose a new password</h2>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">
        Setting a new password signs out every other device.
      </p>
      <form className="mt-6 flex flex-col gap-3" onSubmit={handleSubmit}>
        <Input
          aria-label="New password"
          autoComplete="new-password"
          minLength={8}
          onChange={(event) => setPassword(event.target.value)}
          placeholder="New password (min. 8 characters)"
          required
          type="password"
          value={password}
        />
        <Input
          aria-label="Confirm new password"
          autoComplete="new-password"
          minLength={8}
          onChange={(event) => setConfirm(event.target.value)}
          placeholder="Confirm new password"
          required
          type="password"
          value={confirm}
        />
        {error ? (
          <p
            className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400"
            role="alert"
          >
            {error}
          </p>
        ) : null}
        <Button className="mt-1 w-full" disabled={pending} type="submit">
          {pending ? <Loader2 className="size-4 animate-spin" /> : null}
          Set new password
        </Button>
      </form>
      <p className="mt-6 text-center text-sm text-muted-foreground">
        <Link className="inline-flex items-center gap-1 hover:text-foreground" href="/sign-in">
          <ArrowLeft className="size-3.5" />
          Back to sign in
        </Link>
      </p>
    </div>
  );
}
