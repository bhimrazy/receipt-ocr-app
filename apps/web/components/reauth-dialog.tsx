"use client";

import { Button } from "@receipt-ocr/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@receipt-ocr/ui/components/dialog";
import { Field, FieldError, FieldLabel } from "@receipt-ocr/ui/components/field";
import { Input } from "@receipt-ocr/ui/components/input";
import { Loader2 } from "lucide-react";
import { useState } from "react";
import type { SocialProvider } from "@/components/auth/credentials-form";
import { Turnstile, useTurnstile } from "@/components/turnstile";
import { authErrorMessage } from "@/lib/auth-errors";
import { authClient } from "@/lib/auth-client";

const providerNames: Record<SocialProvider, string> = { google: "Google", github: "GitHub" };

export interface SignInMethods {
  password: boolean;
  providers: SocialProvider[];
}

/**
 * Asks for a fresh sign-in before a sensitive change (Better Auth's `freshAge`). A password
 * sign-in finishes here and calls `onConfirmed`; a Google or GitHub one leaves the page and
 * comes back to `returnTo`.
 */
export function ReauthDialog({
  open,
  onOpenChange,
  email,
  methods,
  action,
  returnTo,
  onConfirmed,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  email: string;
  methods: SignInMethods;
  /** What the user is about to do, after "before you": "delete your account". */
  action: string;
  returnTo: string;
  onConfirmed: () => void | Promise<void>;
}) {
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent>
        {/* Mounts only while open, so the password and errors reset on every open. */}
        <ReauthBody
          action={action}
          email={email}
          methods={methods}
          onConfirmed={async () => {
            onOpenChange(false);
            await onConfirmed();
          }}
          returnTo={returnTo}
        />
      </DialogContent>
    </Dialog>
  );
}

function ReauthBody({
  email,
  methods,
  action,
  returnTo,
  onConfirmed,
}: {
  email: string;
  methods: SignInMethods;
  action: string;
  returnTo: string;
  onConfirmed: () => void | Promise<void>;
}) {
  const turnstile = useTurnstile();
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState<"password" | SocialProvider | null>(null);
  /** Errors of the password form, shown with the field; `error` is for provider sign-in. */
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function withPassword(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (!password) {
      setFieldError("Enter your password.");
      return;
    }
    if (turnstile.blocker) {
      if (!turnstile.broken) setFieldError(turnstile.blocker);
      return;
    }
    setPending("password");
    setFieldError(null);
    const { error: signInError } = await authClient.signIn.email({
      email,
      password,
      fetchOptions: turnstile.fetchOptions,
    });
    turnstile.reset();
    setPending(null);
    if (signInError) {
      // The email is the signed-in one, so a mismatch can only be the password.
      setFieldError(
        signInError.code === "INVALID_EMAIL_OR_PASSWORD"
          ? "That password is not correct."
          : authErrorMessage(signInError),
      );
      return;
    }
    await onConfirmed();
  }

  async function withProvider(provider: SocialProvider) {
    setPending(provider);
    setError(null);
    setFieldError(null);
    const { error: signInError } = await authClient.signIn.social({
      provider,
      callbackURL: returnTo,
      errorCallbackURL: returnTo,
      loginHint: email,
    });
    if (signInError) {
      setError(authErrorMessage(signInError));
      setPending(null);
    }
  }

  const busy = pending !== null;
  return (
    <>
      <DialogHeader>
        <DialogTitle>Confirm it&apos;s you</DialogTitle>
        <DialogDescription>
          You signed in a while ago. Sign in again before you {action}.
        </DialogDescription>
      </DialogHeader>
      {methods.password ? (
        <form className="flex flex-col gap-3" noValidate onSubmit={withPassword}>
          <Field data-invalid={fieldError ? true : undefined}>
            <FieldLabel htmlFor="reauth-password">Password for {email}</FieldLabel>
            <Input
              aria-describedby={fieldError ? "reauth-password-error" : undefined}
              aria-invalid={fieldError ? true : undefined}
              autoComplete="current-password"
              autoFocus
              id="reauth-password"
              maxLength={128}
              onChange={(event) => setPassword(event.target.value)}
              type="password"
              value={password}
            />
            {fieldError ? <FieldError id="reauth-password-error">{fieldError}</FieldError> : null}
          </Field>
          <Turnstile controller={turnstile} />
          <Button aria-busy={turnstile.pending} disabled={busy} type="submit">
            {pending === "password" ? (
              <Loader2 aria-hidden="true" className="animate-spin motion-reduce:animate-none" />
            ) : null}
            Continue
          </Button>
        </form>
      ) : null}
      {methods.providers.map((provider) => (
        <Button
          disabled={busy}
          key={provider}
          onClick={() => withProvider(provider)}
          type="button"
          variant="outline"
        >
          {pending === provider ? (
            <Loader2 aria-hidden="true" className="animate-spin motion-reduce:animate-none" />
          ) : null}
          Continue with {providerNames[provider]}
        </Button>
      ))}
      {!methods.password && methods.providers.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Sign out, sign in again, then come back to Settings.
        </p>
      ) : null}
      {error ? (
        <p className="text-sm text-destructive" id="reauth-error" role="alert">
          {error}
        </p>
      ) : null}
    </>
  );
}
