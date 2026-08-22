"use client";

import { Button } from "@receipt-ocr/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@receipt-ocr/ui/components/card";
import { Input } from "@receipt-ocr/ui/components/input";
import { Check, KeyRound, Loader2, Trash2, UserRound } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { authClient } from "@/lib/auth-client";

const labelClass = "mb-1.5 block text-xs font-medium text-muted-foreground";

function Status({ ok, error }: { ok: string | null; error: string | null }) {
  if (error) {
    return (
      <p
        className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400"
        role="alert"
      >
        {error}
      </p>
    );
  }
  if (ok) {
    return (
      <p className="flex items-center gap-1.5 text-sm text-primary" role="status">
        <Check className="size-4" />
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
    setPending(true);
    setOk(null);
    setError(null);
    const { error: updateError } = await authClient.updateUser({ name: name.trim() });
    setPending(false);
    if (updateError) {
      setError(updateError.message ?? "Couldn't save your profile.");
      return;
    }
    setOk("Profile updated.");
    router.refresh();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <UserRound className="size-5 text-primary" />
          Profile
        </CardTitle>
        <CardDescription>The name shown on your account and to workspace members.</CardDescription>
      </CardHeader>
      <CardContent>
        <form className="flex flex-col gap-3" onSubmit={save}>
          <div>
            <label className={labelClass} htmlFor="name">
              Name
            </label>
            <Input
              id="name"
              onChange={(event) => setName(event.target.value)}
              placeholder="Your name"
              value={name}
            />
          </div>
          <Status error={error} ok={ok} />
          <div>
            <Button disabled={pending || !name.trim() || name.trim() === initialName} type="submit">
              {pending ? <Loader2 className="size-4 animate-spin" /> : null}
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
    setPending(true);
    setOk(null);
    setError(null);
    const { error: changeError } = await authClient.changePassword({
      currentPassword: current,
      newPassword: next,
      revokeOtherSessions: revokeOthers,
    });
    setPending(false);
    if (changeError) {
      setError(changeError.message ?? "Couldn't change your password.");
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
          <KeyRound className="size-5 text-primary" />
          Password
        </CardTitle>
        <CardDescription>
          Only applies to email/password sign-in. Social accounts manage their own credentials.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form className="flex flex-col gap-3" onSubmit={save}>
          <div>
            <label className={labelClass} htmlFor="current-password">
              Current password
            </label>
            <Input
              autoComplete="current-password"
              id="current-password"
              onChange={(event) => setCurrent(event.target.value)}
              required
              type="password"
              value={current}
            />
          </div>
          <div>
            <label className={labelClass} htmlFor="new-password">
              New password
            </label>
            <Input
              autoComplete="new-password"
              id="new-password"
              minLength={8}
              onChange={(event) => setNext(event.target.value)}
              placeholder="Min. 8 characters"
              required
              type="password"
              value={next}
            />
          </div>
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <input
              checked={revokeOthers}
              className="size-4 accent-[var(--primary)]"
              onChange={(event) => setRevokeOthers(event.target.checked)}
              type="checkbox"
            />
            Sign out other devices
          </label>
          <Status error={error} ok={ok} />
          <div>
            <Button disabled={pending || !current || next.length < 8} type="submit">
              {pending ? <Loader2 className="size-4 animate-spin" /> : null}
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
  const [confirmation, setConfirmation] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const armed = confirmation.trim().toLowerCase() === email.toLowerCase();

  async function remove(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!armed) return;
    setPending(true);
    setError(null);
    const { error: deleteError } = await authClient.deleteUser({ callbackURL: "/" });
    setPending(false);
    if (deleteError) {
      setError(deleteError.message ?? "Couldn't delete your account.");
      return;
    }
    // Depending on configuration this either completes immediately or sends a
    // confirmation email, so don't claim the account is gone.
    setNotice("Deletion requested. If we sent a confirmation email, follow the link to finish.");
    router.refresh();
  }

  return (
    <Card className="border-red-500/25">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-red-300">
          <Trash2 className="size-5" />
          Delete account
        </CardTitle>
        <CardDescription>
          Permanently removes your account, your workspaces, and every receipt in them. This cannot
          be undone.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form className="flex flex-col gap-3" onSubmit={remove}>
          <div>
            <label className={labelClass} htmlFor="confirm-delete">
              Type <span className="font-mono text-foreground">{email}</span> to confirm
            </label>
            <Input
              autoComplete="off"
              id="confirm-delete"
              onChange={(event) => setConfirmation(event.target.value)}
              placeholder={email}
              value={confirmation}
            />
          </div>
          {notice ? (
            <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
              {notice}
            </p>
          ) : null}
          <Status error={error} ok={null} />
          <div>
            <Button disabled={!armed || pending} type="submit" variant="destructive">
              {pending ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
              Delete my account
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

/**
 * The account half of Settings. This page used to list raw env var names to
 * end users and offer a "Generate API key later" button that did nothing —
 * developer-facing content in a signed-in user's account area.
 */
export function AccountSettings() {
  const { data: session, isPending } = authClient.useSession();

  if (isPending) {
    return (
      <Card>
        <CardContent className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Loading your account…
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
