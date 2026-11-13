"use client";

import { Button } from "@receipt-ocr/ui/components/button";
import { Card, CardContent } from "@receipt-ocr/ui/components/card";
import { ConfirmDialog } from "@receipt-ocr/ui/components/confirm-dialog";
import { Input } from "@receipt-ocr/ui/components/input";
import { Alert } from "@receipt-ocr/ui/components/alert";
import { Field, FieldDescription, FieldLabel } from "@receipt-ocr/ui/components/field";
import { Check, Loader2, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { SettingsSection } from "@/components/settings-section";
import { withStepUp } from "@/components/step-up/step-up";
import { cancelSubscriptionFirst, soleOwnerMessage } from "@/lib/account-deletion";
import { authErrorMessage } from "@/lib/auth-errors";
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
              {pending ? (
                <Loader2 aria-hidden="true" className="animate-spin motion-reduce:animate-none" />
              ) : null}
              Save
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function EmailCard({ email, emailVerified }: { email: string; emailVerified: boolean }) {
  const [next, setNext] = useState("");
  const [pending, setPending] = useState(false);
  const [ok, setOk] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function request(newEmail: string) {
    setPending(true);
    setError(null);
    setOk(null);
    const { error: changeError } = await withStepUp(
      () => authClient.changeEmail({ newEmail, callbackURL: "/app/settings" }),
      "account.change_email",
    );
    setPending(false);
    if (changeError) {
      setError(authErrorMessage(changeError));
      return;
    }
    setNext("");
    // Better Auth answers the same when the new address already has an account.
    setOk(
      emailVerified
        ? `Check ${email}: approve the change from the link we sent there within 1 hour, then confirm ${newEmail} from the email we send to it.`
        : `Check ${newEmail}: confirm it from the link we sent there within 1 hour to finish the change.`,
    );
  }

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = next.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setOk(null);
      setError("Enter a valid email address, for example name@example.com.");
      return;
    }
    if (trimmed === email.toLowerCase()) {
      setOk(null);
      setError("That's already your email address.");
      return;
    }
    await request(trimmed);
  }

  return (
    <Card>
      <CardContent className="pt-5">
        <form className="flex flex-col gap-3" noValidate onSubmit={save}>
          <p className="text-sm text-muted-foreground">
            Current address: <span className="break-all text-foreground">{email}</span>
          </p>
          <Field data-invalid={error ? true : undefined}>
            <FieldLabel htmlFor="new-email">New email address</FieldLabel>
            <Input
              aria-describedby={error ? "email-error" : undefined}
              aria-invalid={error ? true : undefined}
              autoComplete="email"
              id="new-email"
              inputMode="email"
              onChange={(event) => setNext(event.target.value)}
              placeholder="name@example.com"
              type="email"
              value={next}
            />
          </Field>
          <Status error={error} id="email-error" ok={ok} />
          <div>
            <Button disabled={pending} type="submit">
              {pending ? (
                <Loader2 aria-hidden="true" className="animate-spin motion-reduce:animate-none" />
              ) : null}
              Change email
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
    const { error: changeError } = await withStepUp(
      () =>
        authClient.changePassword({
          currentPassword: current,
          newPassword: next,
          revokeOtherSessions: revokeOthers,
        }),
      "account.change_password",
    );
    setPending(false);
    if (changeError) {
      setError(authErrorMessage(changeError));
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
              {pending ? (
                <Loader2 aria-hidden="true" className="animate-spin motion-reduce:animate-none" />
              ) : null}
              Change password
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function DangerCard({
  email,
  resumed,
  blockingWorkspaces,
  subscribedWorkspaces,
}: {
  email: string;
  resumed: boolean;
  /** Shared workspaces only this user owns: deletion would be refused, so it isn't offered. */
  blockingWorkspaces: string[];
  /** Workspaces whose Pro subscription can still charge: also refused until it is canceled. */
  subscribedWorkspaces: string[];
}) {
  const blocked = blockingWorkspaces.length > 0 || subscribedWorkspaces.length > 0;
  // Sent back from an expired or refused deletion link: reopen the request.
  const [open, setOpen] = useState(resumed && !blocked);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const sent = `We sent a link to ${email}. Open it within 1 hour and confirm to delete your account. Until then, nothing changes.`;

  /** Only emails a link; the account goes when the user confirms on the page it opens. */
  async function request(): Promise<string | void> {
    setNotice(null);
    setError(null);
    const { error: requestError } = await withStepUp(
      () => authClient.deleteUser({}),
      "account.delete",
    );
    if (requestError) return authErrorMessage(requestError);
    setNotice(sent);
  }

  return (
    <Card className="border-destructive/30">
      <CardContent className="flex flex-col gap-3 pt-5">
        <p className="text-sm text-muted-foreground">
          Permanently removes your account, your workspaces and every receipt in them. We email you
          a link to confirm. You can&apos;t undo this.
        </p>
        {blockingWorkspaces.length > 0 ? (
          <Alert variant="warning">
            {soleOwnerMessage(blockingWorkspaces, "come back here")} Owners change roles in that
            workspace&apos;s Settings, under Members.
          </Alert>
        ) : null}
        {subscribedWorkspaces.length > 0 ? (
          <Alert variant="warning">
            {cancelSubscriptionFirst(subscribedWorkspaces)}, in that workspace&apos;s{" "}
            <Link className="font-medium underline underline-offset-4" href="/app/settings/billing">
              Plan and billing
            </Link>{" "}
            page, then come back here.
          </Alert>
        ) : null}
        {notice ? (
          <p className="flex items-start gap-1.5 text-sm text-success" role="status">
            <Check aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            {notice}
          </p>
        ) : null}
        {error ? <Alert variant="destructive">{error}</Alert> : null}
        <div>
          <Button disabled={blocked} onClick={() => setOpen(true)} variant="destructive">
            <Trash2 aria-hidden="true" />
            Delete account
          </Button>
        </div>
      </CardContent>
      <ConfirmDialog
        cancelLabel="Keep my account"
        confirmLabel="Email me the link"
        confirmText={email}
        description={`We'll email a link to ${email}. Open it within 1 hour and confirm there to permanently remove your account, your workspaces and every receipt in them.`}
        destructive
        onConfirm={request}
        onOpenChange={setOpen}
        open={open}
        title="Delete your account?"
      />
    </Card>
  );
}

export function AccountSettings({
  blockingWorkspaces,
  email,
  emailVerified,
  name,
  resume,
  subscribedWorkspaces,
}: {
  blockingWorkspaces: string[];
  subscribedWorkspaces: string[];
  email: string;
  emailVerified: boolean;
  name: string;
  /** `?resume=delete-account` from the deletion confirm page reopens the delete dialog. */
  resume?: "delete-account";
}) {
  // Drop ?resume= so a reload doesn't reopen the dialog.
  useEffect(() => {
    if (resume) window.history.replaceState(null, "", "/app/settings");
  }, [resume]);

  return (
    <>
      <SettingsSection
        description="The name shown on your account and to workspace members."
        id="profile-heading"
        title="Profile"
      >
        <ProfileCard initialName={name} />
      </SettingsSection>
      <SettingsSection
        description="Where we send account emails. The change needs a confirmation from both addresses."
        id="email-heading"
        title="Email"
      >
        <EmailCard email={email} emailVerified={emailVerified} />
      </SettingsSection>
      <SettingsSection
        description="For email sign-in. If you sign in with Google or GitHub, change your password there."
        id="password-heading"
        title="Password"
      >
        <PasswordCard />
      </SettingsSection>
      <SettingsSection
        description="Close your account permanently."
        id="delete-heading"
        title="Delete account"
      >
        <DangerCard
          blockingWorkspaces={blockingWorkspaces}
          email={email}
          resumed={resume === "delete-account"}
          subscribedWorkspaces={subscribedWorkspaces}
        />
      </SettingsSection>
    </>
  );
}
