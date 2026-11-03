"use client";

import { Button } from "@receipt-ocr/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@receipt-ocr/ui/components/card";
import { ConfirmDialog } from "@receipt-ocr/ui/components/confirm-dialog";
import { Input } from "@receipt-ocr/ui/components/input";
import { Label } from "@receipt-ocr/ui/components/label";
import { Skeleton } from "@receipt-ocr/ui/components/skeleton";
import { Check, KeyRound, Loader2, Trash2, UserRound } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { authClient } from "@/lib/auth-client";

function Status({ ok, error, id }: { ok: string | null; error: string | null; id?: string }) {
  if (error) {
    return (
      <p
        className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        id={id}
        role="alert"
      >
        {error}
      </p>
    );
  }
  if (ok) {
    return (
      <p className="flex items-center gap-1.5 text-sm text-primary" role="status">
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
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <UserRound aria-hidden="true" className="size-5 text-primary" />
          Profile
        </CardTitle>
        <CardDescription>The name shown on your account and to workspace members.</CardDescription>
      </CardHeader>
      <CardContent>
        <form className="flex flex-col gap-3" noValidate onSubmit={save}>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="name">Name</Label>
            <Input
              aria-describedby={error ? "name-error" : undefined}
              aria-invalid={error ? true : undefined}
              autoComplete="name"
              id="name"
              onChange={(event) => setName(event.target.value)}
              placeholder="Your name"
              value={name}
            />
          </div>
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
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <KeyRound aria-hidden="true" className="size-5 text-primary" />
          Password
        </CardTitle>
        <CardDescription>
          For email sign-in. If you sign in with a social account, change your password with that provider.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form className="flex flex-col gap-3" noValidate onSubmit={save}>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="current-password">Current password</Label>
            <Input
              aria-describedby={error ? "password-error" : undefined}
              autoComplete="current-password"
              id="current-password"
              onChange={(event) => setCurrent(event.target.value)}
              type="password"
              value={current}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="new-password">New password</Label>
            <Input
              aria-describedby={error ? "password-error new-password-hint" : "new-password-hint"}
              autoComplete="new-password"
              id="new-password"
              onChange={(event) => setNext(event.target.value)}
              type="password"
              value={next}
            />
            <p className="text-xs text-muted-foreground" id="new-password-hint">
              At least 8 characters.
            </p>
          </div>
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
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-destructive">
          <Trash2 aria-hidden="true" className="size-5" />
          Delete account
        </CardTitle>
        <CardDescription>
          Permanently removes your account, your workspaces and every receipt in them. You can&apos;t undo this.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {notice ? (
          <p className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning" role="status">
            {notice}
          </p>
        ) : null}
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
    <div className="space-y-5">
      <ProfileCard initialName={session.user.name ?? ""} />
      <PasswordCard />
      <DangerCard email={session.user.email} />
    </div>
  );
}
