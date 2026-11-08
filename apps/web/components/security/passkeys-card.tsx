"use client";

import { Alert } from "@receipt-ocr/ui/components/alert";
import { Badge } from "@receipt-ocr/ui/components/badge";
import { Button } from "@receipt-ocr/ui/components/button";
import { Card, CardContent } from "@receipt-ocr/ui/components/card";
import { ConfirmDialog } from "@receipt-ocr/ui/components/confirm-dialog";
import { Field, FieldLabel } from "@receipt-ocr/ui/components/field";
import { Input } from "@receipt-ocr/ui/components/input";
import { Check, Fingerprint, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState, useSyncExternalStore } from "react";
import { withStepUp } from "@/components/step-up/step-up";
import { authClient } from "@/lib/auth-client";
import { authErrorMessage, passkeyErrorMessage } from "@/lib/auth-errors";
import { formatDate } from "@/lib/format";

export type PasskeyRow = {
  id: string;
  /** The user's name for it, else the authenticator model, else "Passkey". */
  label: string;
  synced: boolean;
  createdAt: string;
};

const subscribeNever = () => () => {};
const webAuthnAvailable = () => typeof window !== "undefined" && "PublicKeyCredential" in window;

function Spinner() {
  return <Loader2 aria-hidden="true" className="animate-spin motion-reduce:animate-none" />;
}

function RenameForm({ row, onDone }: { row: PasskeyRow; onDone: (renamed: boolean) => void }) {
  const id = useId();
  const [name, setName] = useState(row.label);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return setError("Give it a name.");
    setPending(true);
    const { error: updateError } = await authClient.passkey.updatePasskey({
      id: row.id,
      name: trimmed.slice(0, 60),
    });
    setPending(false);
    if (updateError) return setError(authErrorMessage(updateError));
    onDone(true);
  }

  return (
    <form className="flex flex-col gap-2 sm:flex-row sm:items-end" noValidate onSubmit={save}>
      <Field className="min-w-0 flex-1" data-invalid={error ? true : undefined}>
        <FieldLabel htmlFor={id}>Passkey name</FieldLabel>
        <Input
          aria-describedby={error ? `${id}-error` : undefined}
          autoFocus
          id={id}
          maxLength={60}
          onChange={(event) => setName(event.target.value)}
          value={name}
        />
      </Field>
      <div className="flex gap-2">
        <Button disabled={pending} size="sm" type="submit">
          {pending ? <Spinner /> : null}
          Save
        </Button>
        <Button onClick={() => onDone(false)} size="sm" type="button" variant="outline">
          Cancel
        </Button>
      </div>
      {error ? (
        <p className="text-sm text-destructive" id={`${id}-error`} role="alert">
          {error}
        </p>
      ) : null}
    </form>
  );
}

/** Settings → Security: add, rename and remove passkeys. Adding and removing ask "confirm it's you". */
export function PasskeysCard({ passkeys }: { passkeys: PasskeyRow[] }) {
  const router = useRouter();
  const id = useId();
  const supported = useSyncExternalStore(subscribeNever, webAuthnAvailable, () => true);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [removing, setRemoving] = useState<PasskeyRow | null>(null);

  async function add(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    setNotice(null);
    const { error: addError } = await withStepUp(
      () => authClient.passkey.addPasskey({ name: name.trim().slice(0, 60) || undefined }),
      "passkey.add",
    );
    setPending(false);
    if (addError) return setError(passkeyErrorMessage(addError));
    setAdding(false);
    setName("");
    setNotice("Passkey added. You can now sign in with it.");
    router.refresh();
  }

  async function remove(): Promise<string | void> {
    if (!removing) return;
    const { error: removeError } = await withStepUp(
      () => authClient.passkey.deletePasskey({ id: removing.id }),
      "passkey.remove",
    );
    if (removeError) return authErrorMessage(removeError);
    setNotice("Passkey removed.");
    router.refresh();
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-4 pt-5">
        <div className="flex flex-wrap items-center gap-3">
          <Fingerprint aria-hidden="true" className="size-5 text-muted-foreground" />
          <p className="text-sm font-medium">Passkeys</p>
          {passkeys.length > 0 ? (
            <Badge variant="success">{passkeys.length} added</Badge>
          ) : (
            <Badge variant="secondary">None</Badge>
          )}
        </div>
        <p className="text-sm text-muted-foreground">
          Sign in with your fingerprint, face or device PIN instead of a password, and confirm
          important changes the same way. Your fingerprint or face never leaves your device.
        </p>
        {notice ? (
          <p className="flex items-center gap-1.5 text-sm text-success" role="status">
            <Check aria-hidden="true" className="size-4" />
            {notice}
          </p>
        ) : null}

        {passkeys.length > 0 ? (
          <ul
            aria-label="Your passkeys"
            className="divide-y divide-border rounded-lg border border-border"
          >
            {passkeys.map((row) => (
              <li className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center" key={row.id}>
                {renaming === row.id ? (
                  <div className="min-w-0 flex-1">
                    <RenameForm
                      onDone={(renamed) => {
                        setRenaming(null);
                        if (renamed) router.refresh();
                      }}
                      row={row}
                    />
                  </div>
                ) : (
                  <>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{row.label}</p>
                      <p className="text-xs text-muted-foreground">
                        Added {formatDate(new Date(row.createdAt))}
                        {row.synced ? " · Synced across your devices" : " · This device only"}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        aria-label={`Rename ${row.label}`}
                        onClick={() => setRenaming(row.id)}
                        size="sm"
                        variant="outline"
                      >
                        <Pencil aria-hidden="true" />
                        Rename
                      </Button>
                      <Button
                        aria-label={`Remove ${row.label}`}
                        onClick={() => setRemoving(row)}
                        size="sm"
                        variant="outline"
                      >
                        <Trash2 aria-hidden="true" />
                        Remove
                      </Button>
                    </div>
                  </>
                )}
              </li>
            ))}
          </ul>
        ) : null}

        {!supported ? (
          <Alert variant="warning">This browser can&apos;t use passkeys. Try another one.</Alert>
        ) : adding ? (
          <form className="flex flex-col gap-3" noValidate onSubmit={add}>
            <Field>
              <FieldLabel htmlFor={`${id}-name`}>Name it (optional)</FieldLabel>
              <Input
                autoFocus
                id={`${id}-name`}
                maxLength={60}
                onChange={(event) => setName(event.target.value)}
                placeholder="Work laptop"
                value={name}
              />
            </Field>
            {error ? <Alert variant="destructive">{error}</Alert> : null}
            <div className="flex flex-wrap gap-2">
              <Button disabled={pending} type="submit">
                {pending ? <Spinner /> : null}
                Create passkey
              </Button>
              <Button
                disabled={pending}
                onClick={() => {
                  setAdding(false);
                  setError(null);
                }}
                type="button"
                variant="outline"
              >
                Cancel
              </Button>
            </div>
          </form>
        ) : (
          <div>
            <Button onClick={() => setAdding(true)} type="button" variant="outline">
              <Plus aria-hidden="true" />
              Add a passkey
            </Button>
          </div>
        )}
      </CardContent>
      <ConfirmDialog
        confirmLabel="Remove passkey"
        description="It stops working for this account at once. Remove it from your device or password manager too."
        destructive
        onConfirm={remove}
        onOpenChange={(open) => !open && setRemoving(null)}
        open={removing !== null}
        title={`Remove ${removing?.label ?? "this passkey"}?`}
      />
    </Card>
  );
}
