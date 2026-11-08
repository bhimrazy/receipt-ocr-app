"use client";

import { Button } from "@receipt-ocr/ui/components/button";
import { Loader2, MailCheck } from "lucide-react";
import { useEffect, useState, useSyncExternalStore } from "react";
import { authErrorMessage } from "@/lib/auth-errors";
import { Turnstile, useTurnstile } from "@/components/turnstile";
import { authClient } from "@/lib/auth-client";
import { isStandaloneDisplay } from "@/lib/display-mode";
import { AuthError, AuthMessage } from "./auth-field";
import { FocusHeading } from "./focus-heading";

const RESEND_COOLDOWN_SECONDS = 30;
const noopSubscribe = () => () => {};

/**
 * Shown when an email/password account must confirm its address: right after sign-up, and when
 * an unconfirmed account tries to sign in (Better Auth has already sent a fresh link by then).
 */
export function CheckEmail({
  email,
  reason,
  callbackURL,
  onBack,
}: {
  email: string;
  reason: "sign-up" | "sign-in";
  /** Where the confirmation link sends the user, already signed in. */
  callbackURL: string;
  onBack: () => void;
}) {
  const turnstile = useTurnstile();
  const [cooldown, setCooldown] = useState(RESEND_COOLDOWN_SECONDS);
  const [sending, setSending] = useState(false);
  const [resent, setResent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The link opens in the browser, not in the installed app, which stays signed out.
  const standalone = useSyncExternalStore(noopSubscribe, isStandaloneDisplay, () => false);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  async function resend() {
    setError(null);
    if (turnstile.blocker) {
      if (!turnstile.broken) setError(turnstile.blocker);
      return;
    }
    setSending(true);
    const { error: sendError } = await authClient.sendVerificationEmail({
      email,
      callbackURL,
      fetchOptions: turnstile.fetchOptions,
    });
    turnstile.reset();
    setSending(false);
    if (sendError) {
      setError(authErrorMessage(sendError));
      return;
    }
    setResent(true);
    setCooldown(RESEND_COOLDOWN_SECONDS);
  }

  return (
    <FocusHeading>
      <AuthMessage
        actions={
          <>
            <Button
              className="h-11 w-full"
              disabled={sending || cooldown > 0}
              aria-busy={turnstile.pending}
              onClick={resend}
              variant="outline"
            >
              {sending ? (
                <Loader2 aria-hidden className="size-4 animate-spin motion-reduce:animate-none" />
              ) : null}
              {cooldown > 0 ? (
                <span>
                  Send the link again in <span className="font-mono tabular-nums">{cooldown}s</span>
                </span>
              ) : (
                "Send the link again"
              )}
            </Button>
            <Button className="h-11 w-full" onClick={onBack} variant="ghost">
              Use a different email
            </Button>
          </>
        }
        icon={MailCheck}
        title={reason === "sign-up" ? "Confirm your email" : "Confirm your email first"}
      >
        <p role="status">
          {reason === "sign-up"
            ? "We sent a confirmation link to "
            : "We sent a new confirmation link to "}
          <span className="break-all font-medium text-foreground">{email}</span>. Open it to{" "}
          {reason === "sign-up" ? "finish creating your account" : "sign in"}.
        </p>
        <p>The link expires in 1 hour. If you can&apos;t find the email, check your spam folder.</p>
        {standalone ? <p>After confirming, come back here and sign in.</p> : null}
        {resent && !error ? (
          <p className="text-primary" role="status">
            We sent another link.
          </p>
        ) : null}
        <Turnstile controller={turnstile} />
        {error ? <AuthError>{error}</AuthError> : null}
      </AuthMessage>
    </FocusHeading>
  );
}
