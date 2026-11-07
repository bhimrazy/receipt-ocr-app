"use client";

import { Button } from "@receipt-ocr/ui/components/button";
import { Field, FieldError, FieldLabel } from "@receipt-ocr/ui/components/field";
import { Input } from "@receipt-ocr/ui/components/input";
import { Loader2 } from "lucide-react";
import { useState } from "react";
import type { SocialProvider } from "@/components/auth/credentials-form";
import { Turnstile, useTurnstile } from "@/components/turnstile";
import { authErrorMessage } from "@/lib/auth-errors";
import { authClient } from "@/lib/auth-client";
import type { SignInMethods } from "@/lib/step-up";

const providerNames: Record<SocialProvider, string> = { google: "Google", github: "GitHub" };

/**
 * The step-up check for a user with no second factor: a new sign-in counts for 10 minutes. A
 * password sign-in finishes here and calls `onConfirmed`; a Google or GitHub one leaves the page
 * and comes back to `returnTo`.
 */
export function SignInAgain({
  email,
  methods,
  returnTo,
  onConfirmed,
}: {
  email: string;
  methods: SignInMethods;
  /** Where a Google or GitHub sign-in comes back to. */
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
      {error ? (
        <p className="text-sm text-destructive" id="reauth-error" role="alert">
          {error}
        </p>
      ) : null}
    </>
  );
}
