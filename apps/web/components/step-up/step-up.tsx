"use client";

import { Alert } from "@receipt-ocr/ui/components/alert";
import { Button, buttonVariants } from "@receipt-ocr/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@receipt-ocr/ui/components/dialog";
import { Field, FieldDescription, FieldLabel } from "@receipt-ocr/ui/components/field";
import { Input } from "@receipt-ocr/ui/components/input";
import { OtpInput } from "@receipt-ocr/ui/components/otp-input";
import { Fingerprint, Loader2, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import {
  sendStepUpCodeAction,
  stepUpOptionsAction,
  verifyStepUpAction,
} from "@/lib/step-up-actions";
import type { StepUpOptions } from "@/lib/step-up";
import { authClient } from "@/lib/auth-client";
import { passkeyErrorMessage } from "@/lib/auth-errors";

/**
 * "Verify it's you": one form (dialog or page) and one helper, `withStepUp`,
 * that retries a call once the user passes. The server decides; this only
 * reacts to its STEP_UP_REQUIRED answer.
 */

const STEP_UP_REQUIRED = "STEP_UP_REQUIRED";

type Method = "totp" | "backup_code" | "email";

/** True for a server-action result or a Better Auth client result that asks for step-up. */
export function needsStepUp(result: unknown): boolean {
  if (!result || typeof result !== "object") return false;
  const value = result as { code?: unknown; error?: { code?: unknown } | null };
  return value.code === STEP_UP_REQUIRED || value.error?.code === STEP_UP_REQUIRED;
}

type Requester = (action: string) => Promise<boolean>;
let requester: Requester | null = null;

/**
 * Runs `call`; if the server asks for a fresh check, shows the dialog and runs
 * it once more after the user passes. A cancelled dialog returns the first
 * result. `action` names what asked, for the audit trail; server actions send
 * their own.
 */
export async function withStepUp<T>(call: () => Promise<T>, action?: string): Promise<T> {
  const first = await call();
  if (!needsStepUp(first) || !requester) return first;
  const named = (first as { action?: unknown }).action;
  const label = typeof named === "string" ? named : action;
  if (!label) return first;
  return (await requester(label)) ? call() : first;
}

export function StepUpForm({
  action,
  onVerified,
  onCancel,
  autoFocus = true,
}: {
  action: string;
  onVerified: () => void;
  onCancel?: () => void;
  autoFocus?: boolean;
}) {
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const verifying = useRef(false);
  const [options, setOptions] = useState<StepUpOptions | null>(null);
  const [method, setMethod] = useState<Method | null>(null);
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [pending, setPending] = useState<"send" | "verify" | "passkey" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    stepUpOptionsAction({ action })
      .then((next) => {
        if (!live) return;
        if (next.ok && next.fresh) return onVerified();
        setOptions(next);
        if (next.ok) {
          setMethod(
            next.methods.includes("totp")
              ? "totp"
              : next.methods.includes("email")
                ? "email"
                : null,
          );
        }
      })
      .catch(() => live && setOptions({ ok: false, error: "Couldn't load this. Try again." }));
    return () => {
      live = false;
    };
    // Loaded once per open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (autoFocus && method === "backup_code") inputRef.current?.focus();
  }, [autoFocus, method, sent]);

  async function usePasskey() {
    setPending("passkey");
    setError(null);
    // Signs in again with the passkey; the server counts that session as verified.
    const { error: passkeyError } = await authClient.signIn.passkey();
    setPending(null);
    if (passkeyError) return setError(passkeyErrorMessage(passkeyError));
    onVerified();
  }

  async function send() {
    setPending("send");
    setError(null);
    const result = await sendStepUpCodeAction({ action });
    setPending(null);
    if (!result.ok) return setError(result.error);
    setSent(true);
    setCode("");
    setNotice(options?.ok ? `We emailed a 6-digit code to ${options.email}.` : null);
  }

  async function verify(typed: string) {
    if (!method || verifying.current) return;
    if (!typed.trim()) return setError("Enter the code.");
    verifying.current = true;
    setPending("verify");
    setError(null);
    const result = await verifyStepUpAction({ action, method, code: typed });
    verifying.current = false;
    setPending(null);
    if (!result.ok) {
      setError(result.error);
      if (method === "backup_code") inputRef.current?.select();
      else setCode("");
      return;
    }
    onVerified();
  }

  if (!options) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
        <Loader2 aria-hidden="true" className="size-4 animate-spin motion-reduce:animate-none" />
        Loading…
      </p>
    );
  }
  if (!options.ok) {
    return (
      <div className="flex flex-col gap-3">
        <Alert variant="warning">{options.error}</Alert>
        {options.enrol ? (
          <Link
            className={buttonVariants({ className: "self-start" })}
            href="/app/settings/security"
          >
            Open Security settings
          </Link>
        ) : null}
      </div>
    );
  }

  const hasPasskey = options.methods.includes("passkey");
  const passkeyButton = hasPasskey ? (
    <Button
      className="w-full sm:w-auto"
      disabled={pending !== null}
      onClick={usePasskey}
      type="button"
      variant={method ? "outline" : "default"}
    >
      {pending === "passkey" ? (
        <Loader2 aria-hidden="true" className="animate-spin motion-reduce:animate-none" />
      ) : (
        <Fingerprint aria-hidden="true" />
      )}
      Use your passkey
    </Button>
  ) : null;
  if (!method) {
    return (
      <div className="flex flex-col gap-4">
        {passkeyButton}
        {error ? (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}
        {onCancel ? (
          <Button
            className="self-end"
            disabled={pending !== null}
            onClick={onCancel}
            type="button"
            variant="outline"
          >
            Cancel
          </Button>
        ) : null}
      </div>
    );
  }

  const isEmail = method === "email";
  const isBackup = method === "backup_code";
  const showCode = !isEmail || sent;
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;

  return (
    <form
      className="flex flex-col gap-4"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void verify(code);
      }}
    >
      {passkeyButton ? (
        <>
          {passkeyButton}
          <p className="text-xs text-muted-foreground">Or enter a code:</p>
        </>
      ) : null}
      {isEmail && !sent ? (
        <p className="text-sm text-muted-foreground">
          We&apos;ll email a 6-digit code to{" "}
          <span className="text-foreground">{options.email}</span>. It works once, for 10 minutes.
        </p>
      ) : null}
      {notice ? (
        <p className="text-sm text-muted-foreground" role="status">
          {notice}
        </p>
      ) : null}
      {showCode ? (
        <Field data-invalid={error ? true : undefined}>
          <FieldLabel htmlFor={`${id}-code`}>
            {isBackup ? (
              "Backup code"
            ) : (
              <>
                {isEmail ? "Code from the email" : "Code from your app"}
                <span className="sr-only">, 6 digits</span>
              </>
            )}
          </FieldLabel>
          {isBackup ? (
            <Input
              aria-describedby={error ? `${hintId} ${errorId}` : hintId}
              aria-invalid={error ? true : undefined}
              autoComplete="one-time-code"
              className="font-mono tracking-widest"
              id={`${id}-code`}
              maxLength={11}
              onChange={(event) => setCode(event.target.value)}
              ref={inputRef}
              spellCheck={false}
              value={code}
            />
          ) : (
            <OtpInput
              aria-describedby={error ? `${hintId} ${errorId}` : hintId}
              autoFocus={autoFocus}
              id={`${id}-code`}
              invalid={Boolean(error)}
              key={method}
              onComplete={(done) => void verify(done)}
              onValueChange={setCode}
              pending={pending === "verify"}
              value={code}
            />
          )}
          <FieldDescription id={hintId}>
            {isBackup
              ? "One of the 10 codes you saved, like abcde-12345. Each works once."
              : isEmail
                ? "Didn't get it? Check spam, or send a new code."
                : "The 6-digit code your authenticator app shows for ReceiptOCR."}
          </FieldDescription>
        </Field>
      ) : null}
      {error ? (
        <p className="text-sm text-destructive" id={errorId} role="alert">
          {error}
        </p>
      ) : null}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
        {onCancel ? (
          <Button disabled={pending !== null} onClick={onCancel} type="button" variant="outline">
            Cancel
          </Button>
        ) : null}
        {options.methods.includes("backup_code") ? (
          <Button
            className="sm:mr-auto"
            disabled={pending !== null}
            onClick={() => {
              setMethod(isBackup ? "totp" : "backup_code");
              setCode("");
              setError(null);
            }}
            type="button"
            variant="ghost"
          >
            {isBackup ? "Use your authenticator app" : "Use a backup code"}
          </Button>
        ) : null}
        {isEmail ? (
          <Button
            disabled={pending !== null}
            onClick={send}
            type="button"
            variant={sent ? "ghost" : "default"}
          >
            {pending === "send" ? (
              <Loader2 aria-hidden="true" className="animate-spin motion-reduce:animate-none" />
            ) : null}
            {sent ? "Send a new code" : "Email me a code"}
          </Button>
        ) : null}
        {showCode ? (
          <Button disabled={pending !== null} type="submit">
            {pending === "verify" ? (
              <Loader2 aria-hidden="true" className="animate-spin motion-reduce:animate-none" />
            ) : null}
            Confirm
          </Button>
        ) : null}
      </div>
    </form>
  );
}

/** Mount once per shell (app, admin). Opens the dialog for `withStepUp`. */
export function StepUpProvider() {
  const [request, setRequest] = useState<{
    action: string;
    resolve: (passed: boolean) => void;
  } | null>(null);

  useEffect(() => {
    requester = (action) => new Promise<boolean>((resolve) => setRequest({ action, resolve }));
    return () => {
      requester = null;
    };
  }, []);

  const close = (passed: boolean) => {
    request?.resolve(passed);
    setRequest(null);
  };

  return (
    <Dialog onOpenChange={(open) => !open && close(false)} open={request !== null}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck aria-hidden="true" className="size-5 text-primary" />
            Confirm it&apos;s you
          </DialogTitle>
          <DialogDescription>
            This is a sensitive change, so we check it&apos;s really you. You won&apos;t be asked
            again for 10 minutes.
          </DialogDescription>
        </DialogHeader>
        {request ? (
          <StepUpForm
            action={request.action}
            onCancel={() => close(false)}
            onVerified={() => close(true)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
