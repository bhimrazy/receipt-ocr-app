"use client";

import { Button } from "@receipt-ocr/ui/components/button";
import { Card, CardContent } from "@receipt-ocr/ui/components/card";
import { ConfirmDialog } from "@receipt-ocr/ui/components/confirm-dialog";
import { Input } from "@receipt-ocr/ui/components/input";
import { Alert } from "@receipt-ocr/ui/components/alert";
import { Field, FieldDescription, FieldLabel } from "@receipt-ocr/ui/components/field";
import { Skeleton } from "@receipt-ocr/ui/components/skeleton";
import { Check, Loader2, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { SettingsSection } from "@/components/settings-section";
import { authClient } from "@/lib/auth-client";

function Status({ ok, error, id }: { ok: string | null; error: string | null; id?: string }) {
  if (error) {
    return (
      <Alert id={id} variant="destructive">
        {error}
      </Alert>
    );
  }
  if (ok) {
    return (
      <p className="flex items-center gap-1.5 text-sm text-success" role="status">
        <Check aria-hidden="true" className="size-4" />
        {ok}
      </p>
    );
  }
  return null;
}

function ProfileCard({ initialName }: { initialName: string }) {
  const router = useRouter();
  const [name, setName] = useState(initialName);
  const [pending, setPending] = useState(false);
  const [ok, setOk] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setOk(null);
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Enter your name.");
      return;
    }
    if (trimmed === initialName) {
      setError(null);
      setOk("Your name is already saved.");
      return;
    }
    setPending(true);
    setError(null);
    const { error: updateError } = await authClient.updateUser({ name: trimmed });
    setPending(false);
    if (updateError) {
      setError(updateError.message ?? "Couldn't save your profile. Try again.");
      return;
    }
    setOk("Profile updated.");
    router.refresh();
  }

  return (
    <Card>
      <CardContent className="pt-5">
        <form className="flex flex-col gap-3" noValidate onSubmit={save}>
          <Field data-invalid={error ? true : undefined}>
            <FieldLabel htmlFor="name">Name</FieldLabel>
            <Input
              aria-describedby={error ? "name-error" : undefined}
              aria-invalid={error ? true : undefined}
              autoComplete="name"
              id="name"
              onChange={(event) => setName(event.target.value)}
              placeholder="Your name"
              value={name}
            />
          </Field>
          <Status error={error} id="name-error" ok={ok} />
          <div>
            <Button disabled={pending} type="submit">
              {pending ? <Loader2 aria-hidden="true" className="animate-spin" /> : null}
              Save
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function PasswordCard() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [revokeOthers, setRevokeOthers] = useState(true);
  const [pending, setPending] = useState(false);
  const [ok, setOk] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setOk(null);
    if (!current) {
      setError("Enter your current password.");
      return;
    }
    if (next.length < 8) {
      setError("Use at least 8 characters for your new password.");
      return;
    }
    setPending(true);
    setError(null);
    const { error: changeError } = await authClient.changePassword({
      currentPassword: current,
      newPassword: next,
      revokeOtherSessions: revokeOthers,
    });
    setPending(false);
    if (changeError) {
      setError(changeError.message ?? "Couldn't change your password. Try again.");
      return;
    }
    setCurrent("");
    setNext("");
    setOk("Password changed.");
  }

  return (
    <Card>
      <CardContent className="pt-5">
        <form className="flex flex-col gap-3" noValidate onSubmit={save}>
          <Field>
            <FieldLabel htmlFor="current-password">Current password</FieldLabel>
            <Input
              aria-describedby={error ? "password-error" : undefined}
              autoComplete="current-password"
              id="current-password"
              onChange={(event) => setCurrent(event.target.value)}
              type="password"
              value={current}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="new-password">New password</FieldLabel>
            <Input
              aria-describedby={error ? "password-error new-password-hint" : "new-password-hint"}
              autoComplete="new-password"
              id="new-password"
              onChange={(event) => setNext(event.target.value)}
              type="password"
              value={next}
            />
            <FieldDescription id="new-password-hint">At least 8 characters.</FieldDescription>
          </Field>
          <label className="flex items-center gap-2 text-sm text-muted-foreground max-md:min-h-11">
            <input
              checked={revokeOthers}
              className="size-4 accent-primary focus-visible:ring-2 focus-visible:ring-ring"
              onChange={(event) => setRevokeOthers(event.target.checked)}
              type="checkbox"
            />
            Sign out other devices
          </label>
          <Status error={error} id="password-error" ok={ok} />
          <div>
            <Button disabled={pending} type="submit">
              {pending ? <Loader2 aria-hidden="true" className="animate-spin" /> : null}
              Change password
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function DangerCard({ email }: { email: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  async function remove(): Promise<string | void> {
    const { error: deleteError } = await authClient.deleteUser({ callbackURL: "/" });
    if (deleteError) return deleteError.message ?? "Couldn't delete your account. Try again.";
    // Depending on config this finishes now or sends a confirmation email, so don't claim it's gone.
    setNotice("Deletion requested. If we emailed you a confirmation link, open it to finish.");
    router.refresh();
  }

  return (
    <Card className="border-destructive/30">
      <CardContent className="flex flex-col gap-3 pt-5">
        <p className="text-sm text-muted-foreground">
          Permanently removes your account, your workspaces and every receipt in them. You
          can&apos;t undo this.
        </p>
        {notice ? <Alert variant="warning">{notice}</Alert> : null}
        <div>
          <Button onClick={() => setOpen(true)} variant="destructive">
            <Trash2 aria-hidden="true" />
            Delete account
          </Button>
        </div>
      </CardContent>
      <ConfirmDialog
        cancelLabel="Keep my account"
        confirmLabel="Delete my account"
        confirmText={email}
        description="This permanently removes your account, your workspaces and every receipt in them. You can't undo this."
        destructive
        onConfirm={remove}
        onOpenChange={setOpen}
        open={open}
        title="Delete your account?"
      />
    </Card>
  );
}

export function AccountSettings() {
  const { data: session, isPending } = authClient.useSession();

  if (isPending) {
    return (
      <Card aria-busy="true" aria-label="Loading your account">
        <CardContent className="space-y-3 pt-5">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-10 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (!session) return null;

  return (
    <>
      <SettingsSection
        description="The name shown on your account and to workspace members."
        id="profile-heading"
        title="Profile"
      >
        <ProfileCard initialName={session.user.name ?? ""} />
      </SettingsSection>
      <SettingsSection
        description="For email sign-in. If you sign in with Google or GitHub, change your password there."
        id="password-heading"
        title="Password"
      >
        <PasswordCard />
      </SettingsSection>
      <SettingsSection
        description="Close your account for good."
        id="delete-heading"
        title="Delete account"
      >
        <DangerCard email={session.user.email} />
      </SettingsSection>
    </>
  );
}
