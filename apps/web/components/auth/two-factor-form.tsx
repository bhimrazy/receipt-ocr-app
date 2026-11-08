"use client";

import { Button } from "@receipt-ocr/ui/components/button";
import { OtpInput } from "@receipt-ocr/ui/components/otp-input";
import { cn } from "@receipt-ocr/ui/lib/utils";
import { Loader2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, useSyncExternalStore } from "react";
import { authClient } from "@/lib/auth-client";
import { DEFAULT_REDIRECT } from "@/lib/redirect";
import { authErrorMessage, twoFactorRestart } from "@/lib/auth-errors";
import {
  AuthError,
  AuthField,
  AuthHeading,
  FieldShell,
  authCardClass,
  authFooterClass,
  authLinkClass,
} from "./auth-field";

const subscribeNever = () => () => {};

/** Second step of a password sign-in for accounts with an authenticator app. */
export function TwoFactorForm({
  redirectTo,
  supportEmail,
}: {
  redirectTo: string;
  supportEmail?: string;
}) {
  const router = useRouter();
  const hydrated = useSyncExternalStore(
    subscribeNever,
    () => true,
    () => false,
  );
  const inputRef = useRef<HTMLInputElement>(null);
  const [backup, setBackup] = useState(false);
  const [code, setCode] = useState("");
  const [trust, setTrust] = useState(false);
  const [pending, setPending] = useState(false);
  const submitting = useRef(false);
  const [error, setError] = useState<{ message: string; restart: boolean } | null>(null);
  const signInHref =
    redirectTo === DEFAULT_REDIRECT
      ? "/sign-in"
      : `/sign-in?redirect=${encodeURIComponent(redirectTo)}`;

  async function submit(typed: string) {
    const value = typed.trim();
    if (submitting.current) return;
    if (!value) {
      setError({ message: "Enter the code.", restart: false });
      return;
    }
    submitting.current = true;
    setPending(true);
    setError(null);
    const { error: verifyError } = backup
      ? await authClient.twoFactor.verifyBackupCode({ code: value, trustDevice: trust })
      : await authClient.twoFactor.verifyTotp({ code: value, trustDevice: trust });
    if (verifyError) {
      submitting.current = false;
      setPending(false);
      setError({ message: authErrorMessage(verifyError), restart: twoFactorRestart(verifyError) });
      if (backup) inputRef.current?.select();
      else setCode("");
      return;
    }
    router.push(redirectTo);
    router.refresh();
  }

  return (
    <div className={authCardClass}>
      <AuthHeading title="Enter your code">
        {backup
          ? "Enter one of the backup codes you saved when you turned on two-step sign-in."
          : "Open your authenticator app and enter the 6-digit code for ReceiptOCR."}
      </AuthHeading>
      <form
        className="mt-5 flex flex-col gap-3.5"
        data-ready={hydrated}
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void submit(code);
        }}
      >
        {backup ? (
          <AuthField
            autoComplete="one-time-code"
            autoFocus
            className="font-mono tracking-widest"
            hint="This sign-in step expires after 10 minutes."
            id="two-factor-code"
            key="backup"
            label="Backup code"
            maxLength={11}
            onChange={(event) => setCode(event.target.value)}
            ref={inputRef}
            spellCheck={false}
            value={code}
          />
        ) : (
          <FieldShell
            hint="This sign-in step expires after 10 minutes."
            id="two-factor-code"
            label={
              <>
                Authentication code<span className="sr-only">, 6 digits</span>
              </>
            }
          >
            <OtpInput
              aria-describedby="two-factor-code-hint"
              autoFocus
              id="two-factor-code"
              invalid={Boolean(error)}
              key="totp"
              onComplete={(done) => void submit(done)}
              onValueChange={setCode}
              pending={pending}
              value={code}
            />
          </FieldShell>
        )}
        <label className="flex items-center gap-2 text-sm text-muted-foreground max-md:min-h-11">
          <input
            checked={trust}
            className="size-4 accent-primary focus-visible:ring-2 focus-visible:ring-ring"
            onChange={(event) => setTrust(event.target.checked)}
            type="checkbox"
          />
          Trust this device for 30 days
        </label>
        <Button className="mt-1 h-11 w-full" disabled={pending} type="submit">
          {pending ? (
            <Loader2 aria-hidden className="size-4 animate-spin motion-reduce:animate-none" />
          ) : null}
          Verify
        </Button>
        {/* Under the button, so an error moves only what is below it. */}
        {error ? (
          <AuthError>
            {error.message}{" "}
            {error.restart ? (
              <Link className={cn(authLinkClass, "text-destructive underline")} href={signInHref}>
                Sign in again
              </Link>
            ) : null}
          </AuthError>
        ) : null}
        <Button
          className="h-11 w-full"
          disabled={pending}
          onClick={() => {
            setBackup((value) => !value);
            setCode("");
            setError(null);
          }}
          type="button"
          variant="ghost"
        >
          {backup ? "Use your authenticator app" : "Use a backup code"}
        </Button>
      </form>
      {supportEmail ? (
        <p className={authFooterClass}>
          Lost your phone and your backup codes?{" "}
          <a
            className={cn(authLinkClass, "inline-flex min-h-11 items-center")}
            href={`mailto:${supportEmail}`}
          >
            Contact support
          </a>
        </p>
      ) : null}
    </div>
  );
}
