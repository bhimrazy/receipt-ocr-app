"use client";

import { Alert } from "@receipt-ocr/ui/components/alert";
import { Button } from "@receipt-ocr/ui/components/button";
import { Card, CardContent } from "@receipt-ocr/ui/components/card";
import { ConfirmDialog } from "@receipt-ocr/ui/components/confirm-dialog";
import { Field, FieldDescription, FieldLabel } from "@receipt-ocr/ui/components/field";
import { Input } from "@receipt-ocr/ui/components/input";
import { Check, Copy, Download, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { withStepUp } from "@/components/step-up/step-up";
import { authClient } from "@/lib/auth-client";
import { authErrorMessage } from "@/lib/auth-errors";
import { backupCodesText, formatTotpKey, totpKeyFromUri } from "@/lib/totp-uri";
import { QrCode } from "./qr-code";

type Step =
  | { kind: "idle" }
  | { kind: "password"; purpose: Purpose }
  | { kind: "scan"; totpURI: string; backupCodes: string[] }
  | { kind: "codes"; backupCodes: string[] };

function Spinner() {
  return <Loader2 aria-hidden="true" className="animate-spin motion-reduce:animate-none" />;
}

/** Copy to the clipboard with a visible "Copied" status. */
function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        } catch {
          setCopied(false);
        }
      }}
      size="sm"
      type="button"
      variant="outline"
    >
      {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
      <span aria-live="polite">{copied ? "Copied" : label}</span>
    </Button>
  );
}

function BackupCodes({
  codes,
  email,
  onDone,
}: {
  codes: string[];
  email: string;
  onDone: () => void;
}) {
  const id = useId();
  const [saved, setSaved] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => headingRef.current?.focus(), []);

  function download() {
    const blob = new Blob([backupCodesText(codes, email)], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "receiptocr-backup-codes.txt";
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h3 className="text-sm font-semibold outline-none" ref={headingRef} tabIndex={-1}>
          Save your backup codes
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">
          If you lose your phone, each code signs you in once. This is the only time we show them.
        </p>
      </div>
      <ul
        aria-label="Backup codes"
        className="grid grid-cols-1 gap-2 rounded-lg border border-border bg-muted/40 p-4 font-mono text-sm sm:grid-cols-2"
      >
        {codes.map((code) => (
          <li className="tabular-nums" key={code}>
            {code}
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        <CopyButton label="Copy codes" text={codes.join("\n")} />
        <Button onClick={download} size="sm" type="button" variant="outline">
          <Download aria-hidden="true" />
          Download
        </Button>
      </div>
      <label className="flex items-center gap-2 text-sm max-md:min-h-11" htmlFor={id}>
        <input
          checked={saved}
          className="size-4 accent-primary focus-visible:ring-2 focus-visible:ring-ring"
          id={id}
          onChange={(event) => setSaved(event.target.checked)}
          type="checkbox"
        />
        I&apos;ve saved these codes somewhere safe
      </label>
      <div>
        <Button disabled={!saved} onClick={onDone} type="button">
          Done
        </Button>
      </div>
    </div>
  );
}

function Scan({
  totpURI,
  onVerified,
  onCancel,
}: {
  totpURI: string;
  onVerified: () => void;
  onCancel: () => void;
}) {
  const id = useId();
  const [code, setCode] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const key = totpKeyFromUri(totpURI) ?? "";
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => headingRef.current?.focus(), []);

  async function verify(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!/^\d{6}$/.test(code.trim())) return setError("Enter the 6-digit code from your app.");
    setPending(true);
    setError(null);
    const { error: verifyError } = await authClient.twoFactor.verifyTotp({ code: code.trim() });
    setPending(false);
    if (verifyError) {
      return setError(
        verifyError.code === "INVALID_CODE"
          ? "That code isn't right. Check the time on your phone and try the newest code."
          : authErrorMessage(verifyError),
      );
    }
    onVerified();
  }

  return (
    <form className="flex flex-col gap-5" noValidate onSubmit={verify}>
      <h3 className="text-sm font-semibold outline-none" ref={headingRef} tabIndex={-1}>
        Set up your authenticator app
      </h3>
      <ol className="flex list-decimal flex-col gap-4 pl-5 text-sm">
        <li>
          Open an authenticator app (Google Authenticator, 1Password, Authy, your phone&apos;s
          password manager) and add an account.
        </li>
        <li className="flex flex-col gap-3">
          <span>Scan this code, or enter the key by hand.</span>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
            <QrCode label="QR code for your authenticator app" value={totpURI} />
            <div className="flex min-w-0 flex-col gap-2">
              <span className="text-xs text-muted-foreground">
                Can&apos;t scan? Enter this key:
              </span>
              <code className="font-mono text-sm break-all" data-testid="totp-key">
                {formatTotpKey(key)}
              </code>
              <div className="flex flex-wrap gap-2">
                <CopyButton label="Copy key" text={key} />
                <a
                  className="inline-flex min-h-8 items-center text-sm text-primary underline-offset-4 hover:underline max-md:min-h-11 sm:hidden"
                  href={totpURI}
                >
                  Open in your authenticator app
                </a>
              </div>
            </div>
          </div>
        </li>
        <li>
          <Field data-invalid={error ? true : undefined}>
            <FieldLabel htmlFor={id}>Enter the 6-digit code it shows</FieldLabel>
            <Input
              aria-describedby={error ? `${id}-error` : undefined}
              aria-invalid={error ? true : undefined}
              autoComplete="one-time-code"
              className="max-w-40 font-mono tracking-widest"
              id={id}
              inputMode="numeric"
              maxLength={6}
              onChange={(event) => setCode(event.target.value)}
              pattern="[0-9]*"
              value={code}
            />
          </Field>
        </li>
      </ol>
      {error ? (
        <p className="text-sm text-destructive" id={`${id}-error`} role="alert">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button disabled={pending} type="submit">
          {pending ? <Spinner /> : null}
          Turn on
        </Button>
        <Button disabled={pending} onClick={onCancel} type="button" variant="outline">
          Cancel
        </Button>
      </div>
    </form>
  );
}

type Purpose = "enable" | "regenerate" | "disable";

/** With a password, each action asks for it first; the sentence says what it is for. */
const PASSWORD_COPY = {
  enable: { hint: "Needed to set up an authenticator app.", button: "Continue" },
  regenerate: { hint: "Needed to make new backup codes.", button: "Make new codes" },
  disable: {
    hint: "Turning this off means your password alone signs you in. You can turn it back on at any time.",
    button: "Turn off",
  },
} as const;

export function TwoFactorCard({
  enabled,
  hasPassword,
  email,
  readOnly = false,
}: {
  enabled: boolean;
  hasPassword: boolean;
  email: string;
  /** Impersonation: the state alone, no controls. */
  readOnly?: boolean;
}) {
  const router = useRouter();
  const id = useId();
  const [step, setStep] = useState<Step>({ kind: "idle" });
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmingOff, setConfirmingOff] = useState(false);
  const noticeRef = useRef<HTMLParagraphElement>(null);
  // Set with a notice whose control went away (the codes view), so focus lands on it.
  const focusNotice = useRef(false);

  useEffect(() => {
    if (!focusNotice.current) return;
    focusNotice.current = false;
    noticeRef.current?.focus();
  }, [notice]);

  function reset() {
    setStep({ kind: "idle" });
    setPassword("");
    setError(null);
  }

  function showNotice(text: string) {
    focusNotice.current = true;
    setNotice(text);
  }

  /** Runs one action; returns the error message, if any. */
  async function run(purpose: Purpose): Promise<string | void> {
    const body = hasPassword ? { password } : {};
    if (hasPassword && !password) return "Enter your password.";
    setNotice(null);
    if (purpose === "enable") {
      // Enrolling is checked too: otherwise a stolen session could add its own authenticator.
      const { data, error: enableError } = await withStepUp(
        () => authClient.twoFactor.enable(body as { password: string }),
        "two_factor.enable",
      );
      if (enableError || !data || !("totpURI" in data) || !data.totpURI) {
        return authErrorMessage(enableError);
      }
      setPassword("");
      setStep({ kind: "scan", totpURI: data.totpURI, backupCodes: data.backupCodes ?? [] });
      return;
    }
    if (purpose === "regenerate") {
      const { data, error: codesError } = await withStepUp(
        () => authClient.twoFactor.generateBackupCodes(body as { password: string }),
        "two_factor.regenerate_backup_codes",
      );
      if (codesError || !data) return authErrorMessage(codesError);
      setPassword("");
      setStep({ kind: "codes", backupCodes: data.backupCodes });
      return;
    }
    const { error: disableError } = await withStepUp(
      () => authClient.twoFactor.disable(body as { password: string }),
      "two_factor.disable",
    );
    if (disableError) return authErrorMessage(disableError);
    reset();
    showNotice("Two-step sign-in is off.");
    router.refresh();
  }

  async function submit(purpose: Purpose) {
    setPending(true);
    setError(null);
    try {
      const failed = await run(purpose);
      if (failed) setError(failed);
    } finally {
      setPending(false);
    }
  }

  /** With a password, ask for it first. Without one, the step-up dialog is the only check. */
  function begin(purpose: Purpose) {
    if (hasPassword) return setStep({ kind: "password", purpose });
    if (purpose === "disable") return setConfirmingOff(true);
    void submit(purpose);
  }

  if (readOnly) {
    return (
      <Card>
        <CardContent className="pt-5">
          <p className="text-sm">
            {enabled ? "An authenticator app is set up." : "No authenticator app is set up."}
          </p>
        </CardContent>
      </Card>
    );
  }

  if (step.kind === "scan") {
    return (
      <Card>
        <CardContent className="pt-5">
          <Scan
            onCancel={reset}
            onVerified={() => setStep({ kind: "codes", backupCodes: step.backupCodes })}
            totpURI={step.totpURI}
          />
        </CardContent>
      </Card>
    );
  }

  if (step.kind === "codes") {
    return (
      <Card>
        <CardContent className="pt-5">
          <BackupCodes
            codes={step.backupCodes}
            email={email}
            onDone={() => {
              reset();
              showNotice(enabled ? "New backup codes saved." : "Two-step sign-in is on.");
              router.refresh();
            }}
          />
        </CardContent>
      </Card>
    );
  }

  const asking = step.kind === "password" ? step.purpose : null;

  return (
    <Card>
      <CardContent className="flex flex-col gap-4 pt-5">
        {notice ? (
          <p
            className="flex items-center gap-1.5 text-sm text-success outline-none"
            ref={noticeRef}
            role="status"
            tabIndex={-1}
          >
            <Check aria-hidden="true" className="size-4" />
            {notice}
          </p>
        ) : null}

        {asking ? (
          <form
            className="flex flex-col gap-3"
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              void submit(asking);
            }}
          >
            <Field data-invalid={error ? true : undefined}>
              <FieldLabel htmlFor={`${id}-password`}>Your password</FieldLabel>
              <Input
                aria-describedby={error ? `${id}-hint ${id}-error` : `${id}-hint`}
                aria-invalid={error ? true : undefined}
                autoComplete="current-password"
                autoFocus
                id={`${id}-password`}
                onChange={(event) => setPassword(event.target.value)}
                type="password"
                value={password}
              />
              <FieldDescription id={`${id}-hint`}>{PASSWORD_COPY[asking].hint}</FieldDescription>
            </Field>
            {error ? (
              <Alert id={`${id}-error`} variant="destructive">
                {error}
              </Alert>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <Button
                disabled={pending}
                type="submit"
                variant={asking === "disable" ? "destructive" : "default"}
              >
                {pending ? <Spinner /> : null}
                {PASSWORD_COPY[asking].button}
              </Button>
              <Button disabled={pending} onClick={reset} type="button" variant="outline">
                Cancel
              </Button>
            </div>
          </form>
        ) : (
          <>
            {error ? <Alert variant="destructive">{error}</Alert> : null}
            {enabled ? (
              <div className="flex flex-wrap gap-2">
                <Button
                  disabled={pending}
                  onClick={() => begin("regenerate")}
                  type="button"
                  variant="outline"
                >
                  {pending ? <Spinner /> : null}
                  New backup codes
                </Button>
                <Button
                  disabled={pending}
                  onClick={() => begin("disable")}
                  type="button"
                  variant="outline"
                >
                  Turn off
                </Button>
              </div>
            ) : (
              <div>
                <Button disabled={pending} onClick={() => begin("enable")} type="button">
                  {pending ? <Spinner /> : null}
                  Set up authenticator app
                </Button>
              </div>
            )}
          </>
        )}
      </CardContent>
      <ConfirmDialog
        confirmLabel="Turn off"
        description="Important changes will then be confirmed by a passkey or a code emailed to you."
        destructive
        focusAfterConfirm={noticeRef}
        onConfirm={() => run("disable")}
        onOpenChange={setConfirmingOff}
        open={confirmingOff}
        title="Turn off two-step sign-in?"
      />
    </Card>
  );
}
