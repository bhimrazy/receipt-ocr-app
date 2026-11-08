"use client";

import { Alert } from "@receipt-ocr/ui/components/alert";
import { Badge } from "@receipt-ocr/ui/components/badge";
import { Button, buttonVariants } from "@receipt-ocr/ui/components/button";
import { Card, CardContent } from "@receipt-ocr/ui/components/card";
import { ConfirmDialog } from "@receipt-ocr/ui/components/confirm-dialog";
import { Field, FieldDescription, FieldLabel } from "@receipt-ocr/ui/components/field";
import { Input } from "@receipt-ocr/ui/components/input";
import { Check, ChevronRight, Fingerprint, KeyRound, Loader2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useState } from "react";
import { setPasswordAction } from "@/app/app/settings/security/actions";
import { ProviderIcon } from "@/components/security/provider-icon";
import { withStepUp } from "@/components/step-up/step-up";
import { authClient } from "@/lib/auth-client";
import { authErrorMessage } from "@/lib/auth-errors";
import { formatDate } from "@/lib/format";

export type ProviderRow = {
  id: "google" | "github";
  label: string;
  /** Better Auth's account row id when connected. */
  accountId: string | null;
  connectedAt: string | null;
  /** False when it's the last way to sign in: the server refuses too. */
  canDisconnect: boolean;
};

const LAST_METHOD = "Set a password or add a passkey first.";

function Spinner() {
  return <Loader2 aria-hidden="true" className="animate-spin motion-reduce:animate-none" />;
}

function SetPasswordForm({ onDone }: { onDone: (set: boolean) => void }) {
  const id = useId();
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (password.length < 8) return setError("Use at least 8 characters for your password.");
    setPending(true);
    setError(null);
    const result = await withStepUp(() => setPasswordAction({ newPassword: password }));
    setPending(false);
    if (!result.ok) return setError(result.error);
    onDone(true);
  }

  return (
    <form className="flex flex-col gap-3" noValidate onSubmit={save}>
      <Field data-invalid={error ? true : undefined}>
        <FieldLabel htmlFor={`${id}-password`}>New password</FieldLabel>
        <Input
          aria-describedby={error ? `${id}-error ${id}-hint` : `${id}-hint`}
          aria-invalid={error ? true : undefined}
          autoComplete="new-password"
          autoFocus
          id={`${id}-password`}
          maxLength={128}
          onChange={(event) => setPassword(event.target.value)}
          type="password"
          value={password}
        />
        <FieldDescription id={`${id}-hint`}>At least 8 characters.</FieldDescription>
      </Field>
      {error ? (
        <Alert id={`${id}-error`} variant="destructive">
          {error}
        </Alert>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button disabled={pending} type="submit">
          {pending ? <Spinner /> : null}
          Set password
        </Button>
        <Button disabled={pending} onClick={() => onDone(false)} type="button" variant="outline">
          Cancel
        </Button>
      </div>
    </form>
  );
}

/**
 * Settings → Security: every way into the account. Connecting goes through the provider and
 * back here; disconnecting asks "confirm it's you", and the server refuses the last method.
 */
export function SignInMethodsCard({
  email,
  hasPassword,
  passkeys,
  providers,
  identities,
  readOnly,
  outcome,
}: {
  email: string;
  hasPassword: boolean;
  passkeys: number;
  providers: ProviderRow[];
  /** Server-rendered "who is connected" lines, streamed in per provider. */
  identities: Partial<Record<ProviderRow["id"], React.ReactNode>>;
  /** An impersonation session sees the list without controls. */
  readOnly: boolean;
  outcome: { ok: boolean; message: string } | null;
}) {
  const router = useRouter();
  const [settingPassword, setSettingPassword] = useState(false);
  const [pending, setPending] = useState<ProviderRow["id"] | null>(null);
  const [notice, setNotice] = useState<string | null>(outcome?.ok ? outcome.message : null);
  const [error, setError] = useState<string | null>(
    outcome && !outcome.ok ? outcome.message : null,
  );
  const [removing, setRemoving] = useState<ProviderRow | null>(null);

  // Drop ?linked= / ?link=&error= so a reload doesn't repeat the message.
  useEffect(() => {
    if (outcome)
      window.history.replaceState(null, "", "/app/settings/security#sign-in-methods-heading");
  }, [outcome]);

  async function connect(provider: ProviderRow) {
    setPending(provider.id);
    setError(null);
    setNotice(null);
    const { error: linkError } = await authClient.linkSocial({
      provider: provider.id,
      callbackURL: `/app/settings/security?linked=${provider.id}`,
      errorCallbackURL: `/app/settings/security?link=${provider.id}`,
    });
    // On success the browser is already leaving for the provider.
    if (linkError) {
      setPending(null);
      setError(authErrorMessage(linkError));
    }
  }

  async function disconnect(): Promise<string | void> {
    if (!removing?.accountId) return;
    const accountId = removing.accountId;
    const { error: unlinkError } = await withStepUp(
      () => authClient.unlinkAccount({ accountId }),
      "account.unlink",
    );
    if (unlinkError) return authErrorMessage(unlinkError);
    setNotice(`${removing.label} is disconnected.`);
    router.refresh();
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-4 pt-5">
        {notice ? (
          <p className="flex items-center gap-1.5 text-sm text-success" role="status">
            <Check aria-hidden="true" className="size-4 shrink-0" />
            {notice}
          </p>
        ) : null}
        {error ? <Alert variant="destructive">{error}</Alert> : null}

        <ul
          aria-label="Ways to sign in"
          className="divide-y divide-border rounded-lg border border-border"
        >
          <li className="flex flex-col gap-3 p-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <KeyRound aria-hidden="true" className="size-5 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">Email and password</p>
                <p className="text-xs break-all text-muted-foreground">
                  {email} · {hasPassword ? "Password set" : "No password yet"}
                </p>
              </div>
              {readOnly ? null : hasPassword ? (
                <Link
                  className={buttonVariants({ size: "sm", variant: "outline" })}
                  href="/app/settings#password-heading"
                >
                  Change password
                  <ChevronRight aria-hidden="true" />
                </Link>
              ) : settingPassword ? null : (
                <Button onClick={() => setSettingPassword(true)} size="sm" variant="outline">
                  Set a password
                </Button>
              )}
            </div>
            {settingPassword && !hasPassword ? (
              <SetPasswordForm
                onDone={(set) => {
                  setSettingPassword(false);
                  if (!set) return;
                  setNotice("Password set. You can now sign in with your email and password.");
                  router.refresh();
                }}
              />
            ) : null}
          </li>

          {providers.map((provider) => (
            <li className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center" key={provider.id}>
              <ProviderIcon className="size-5 shrink-0" provider={provider.id} />
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 text-sm font-medium">
                  {provider.label}
                  {provider.accountId ? <Badge variant="success">Connected</Badge> : null}
                </p>
                {provider.accountId ? (
                  <>
                    {/* min-h: the streamed line replaces a same-height skeleton. */}
                    <div className="min-h-4 text-xs break-all text-muted-foreground">
                      {identities[provider.id]}
                    </div>
                    {provider.connectedAt ? (
                      <p className="text-xs text-muted-foreground">
                        Connected {formatDate(new Date(provider.connectedAt))}
                      </p>
                    ) : null}
                  </>
                ) : (
                  <p className="text-xs text-muted-foreground">Not connected</p>
                )}
                {provider.accountId && !provider.canDisconnect && !readOnly ? (
                  <p className="mt-1 text-xs text-muted-foreground" id={`${provider.id}-last`}>
                    {LAST_METHOD}
                  </p>
                ) : null}
              </div>
              {readOnly ? null : provider.accountId ? (
                <Button
                  aria-describedby={provider.canDisconnect ? undefined : `${provider.id}-last`}
                  aria-label={`Disconnect ${provider.label}`}
                  disabled={!provider.canDisconnect}
                  onClick={() => setRemoving(provider)}
                  size="sm"
                  variant="outline"
                >
                  Disconnect
                </Button>
              ) : (
                <Button
                  aria-label={`Connect ${provider.label}`}
                  disabled={pending !== null}
                  onClick={() => connect(provider)}
                  size="sm"
                  variant="outline"
                >
                  {pending === provider.id ? <Spinner /> : null}
                  Connect
                </Button>
              )}
            </li>
          ))}

          <li className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center">
            <Fingerprint aria-hidden="true" className="size-5 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">Passkeys</p>
              <p className="text-xs text-muted-foreground">
                {passkeys === 0 ? "None added" : `${passkeys} added`}
              </p>
            </div>
            <Link
              className={buttonVariants({ size: "sm", variant: "outline" })}
              href="#passkeys-heading"
            >
              {passkeys === 0 ? "Add" : "Manage"}
              <ChevronRight aria-hidden="true" />
            </Link>
          </li>
        </ul>
        {providers.length > 0 ? (
          <p className="text-xs text-muted-foreground">
            A Google or GitHub account can connect only if it uses {email}, confirmed.
          </p>
        ) : null}
      </CardContent>
      <ConfirmDialog
        confirmLabel="Disconnect"
        description={`You won't be able to sign in with ${removing?.label ?? "it"} any more. You can connect it again later.`}
        destructive
        onConfirm={disconnect}
        onOpenChange={(open) => !open && setRemoving(null)}
        open={removing !== null}
        title={`Disconnect ${removing?.label ?? "this account"}?`}
      />
    </Card>
  );
}
