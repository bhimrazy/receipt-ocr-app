"use client";

import { Button, buttonVariants } from "@receipt-ocr/ui/components/button";
import { cn } from "@receipt-ocr/ui/lib/utils";
import { Check, Link2Off, Loader2, MailWarning, UserRoundX, UsersRound } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { authErrorMessage } from "@/lib/auth-errors";
import { authClient } from "@/lib/auth-client";
import { DEFAULT_REDIRECT } from "@/lib/redirect";
import { AuthError, AuthMessage, AuthNotice, authCardClass } from "./auth-field";

type InvitationDetails = NonNullable<
  Awaited<ReturnType<typeof authClient.organization.getInvitation>>["data"]
>;

/** Why the invitation can't be shown, from Better Auth's getInvitation error code. */
type LoadProblem = "wrong-account" | "unverified" | "unusable";

function problemFromCode(code: string | undefined): LoadProblem {
  if (code === "YOU_ARE_NOT_THE_RECIPIENT_OF_THE_INVITATION") return "wrong-account";
  if (code?.startsWith("EMAIL_VERIFICATION_REQUIRED")) return "unverified";
  return "unusable";
}

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

const appLink = cn(buttonVariants({ variant: "ghost" }), "h-11 w-full");

export function AcceptInvitation({ invitationId }: { invitationId: string }) {
  const { data: session, isPending: sessionPending } = authClient.useSession();
  const router = useRouter();

  const [invitation, setInvitation] = useState<InvitationDetails | null>(null);
  const [problem, setProblem] = useState<LoadProblem | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [action, setAction] = useState<"accept" | "reject" | "sign-out" | "verify" | null>(null);
  const [verificationSent, setVerificationSent] = useState(false);

  const signedIn = Boolean(session);
  const returnPath = `/accept-invitation/${invitationId}`;

  // Signed-out visitors sign in (or sign up) first and come back here.
  useEffect(() => {
    if (sessionPending || signedIn) return;
    router.replace(`/sign-in?redirect=${encodeURIComponent(returnPath)}`);
  }, [sessionPending, signedIn, returnPath, router]);

  useEffect(() => {
    if (!signedIn) return;
    let cancelled = false;
    (async () => {
      const { data, error: fetchError } = await authClient.organization.getInvitation({
        query: { id: invitationId },
      });
      if (cancelled) return;
      if (fetchError || !data) setProblem(problemFromCode(fetchError?.code));
      else setInvitation(data);
    })();
    return () => {
      cancelled = true;
    };
  }, [signedIn, invitationId]);

  async function handleAccept() {
    setAction("accept");
    setError(null);
    const { data, error: acceptError } = await authClient.organization.acceptInvitation({
      invitationId,
    });
    if (acceptError || !data) {
      setError(authErrorMessage(acceptError));
      setAction(null);
      return;
    }
    // Make the joined workspace active before dropping the user into the app.
    if (data.invitation?.organizationId) {
      await authClient.organization.setActive({ organizationId: data.invitation.organizationId });
    }
    router.push(DEFAULT_REDIRECT);
    router.refresh();
  }

  async function handleReject() {
    setAction("reject");
    setError(null);
    const { error: rejectError } = await authClient.organization.rejectInvitation({ invitationId });
    if (rejectError) {
      setError(authErrorMessage(rejectError));
      setAction(null);
      return;
    }
    router.push(DEFAULT_REDIRECT);
  }

  async function switchAccount() {
    setAction("sign-out");
    await authClient.signOut();
    router.replace(`/sign-in?redirect=${encodeURIComponent(returnPath)}`);
    router.refresh();
  }

  async function sendVerification() {
    if (!session) return;
    setAction("verify");
    setError(null);
    const { error: sendError } = await authClient.sendVerificationEmail({
      email: session.user.email,
      callbackURL: returnPath,
    });
    setAction(null);
    if (sendError) setError(authErrorMessage(sendError));
    else setVerificationSent(true);
  }

  if (sessionPending || !signedIn || (!invitation && !problem)) {
    return (
      <div className={authCardClass}>
        <h1 className="text-2xl font-semibold tracking-tight">Workspace invitation</h1>
        <p className="mt-3 flex items-center gap-2 text-sm text-muted-foreground" role="status">
          <Loader2 aria-hidden className="size-4 animate-spin" />
          {signedIn ? "Loading your invitation…" : "Checking your sign-in…"}
        </p>
      </div>
    );
  }

  const email = session?.user.email ?? "";
  const busy = action !== null;

  if (problem === "wrong-account") {
    return (
      <AuthMessage
        actions={
          <>
            <Button className="h-11 w-full" disabled={busy} onClick={switchAccount}>
              {action === "sign-out" ? (
                <Loader2 aria-hidden className="size-4 animate-spin" />
              ) : null}
              Sign out and switch account
            </Button>
            <Link className={appLink} href={DEFAULT_REDIRECT}>
              Go to the app
            </Link>
          </>
        }
        icon={UserRoundX}
        title="This invitation is for a different email"
        tone="warning"
      >
        <p>
          You are signed in as{" "}
          <span className="break-all font-medium text-foreground">{email}</span>. Sign out, then
          sign in or create an account with the email address the invitation was sent to.
        </p>
      </AuthMessage>
    );
  }

  if (problem === "unverified") {
    return (
      <AuthMessage
        actions={
          verificationSent ? undefined : (
            <Button className="h-11 w-full" disabled={busy} onClick={sendVerification}>
              {action === "verify" ? <Loader2 aria-hidden className="size-4 animate-spin" /> : null}
              Send confirmation link
            </Button>
          )
        }
        icon={MailWarning}
        title="Confirm your email first"
        tone="warning"
      >
        <p>
          To accept this invitation, confirm{" "}
          <span className="break-all font-medium text-foreground">{email}</span>. The link brings
          you back to this page.
        </p>
        {verificationSent ? <AuthNotice>We sent the link. It expires in 1 hour.</AuthNotice> : null}
        {error ? <AuthError>{error}</AuthError> : null}
      </AuthMessage>
    );
  }

  if (problem === "unusable" || !invitation) {
    return (
      <AuthMessage
        actions={
          <Link
            className={cn(buttonVariants({ variant: "outline" }), "h-11 w-full")}
            href={DEFAULT_REDIRECT}
          >
            Go to the app
          </Link>
        }
        icon={Link2Off}
        title="This invitation can't be used"
        tone="warning"
      >
        <p>
          It has expired, was cancelled, or was already answered. Ask the person who invited you to
          send a new one.
        </p>
      </AuthMessage>
    );
  }

  const details = [
    { label: "Workspace", value: invitation.organizationName },
    { label: "Role", value: capitalize(invitation.role) },
    { label: "Invited by", value: invitation.inviterEmail, mono: true },
    { label: "Signed in as", value: email, mono: true },
  ];

  return (
    <AuthMessage
      actions={
        <>
          <Button className="h-11 w-full" disabled={busy} onClick={handleAccept}>
            {action === "accept" ? (
              <Loader2 aria-hidden className="size-4 animate-spin" />
            ) : (
              <Check aria-hidden className="size-4" />
            )}
            Join {invitation.organizationName}
          </Button>
          <Button className="h-11 w-full" disabled={busy} onClick={handleReject} variant="ghost">
            {action === "reject" ? <Loader2 aria-hidden className="size-4 animate-spin" /> : null}
            Decline invitation
          </Button>
        </>
      }
      icon={UsersRound}
      title={`Join ${invitation.organizationName}`}
    >
      <p>
        You can see this workspace&apos;s receipts and add your own. Your personal workspace stays
        as it is.
      </p>
      <dl className="divide-y divide-border rounded-xl bg-background/50 ring-1 ring-inset ring-border">
        {details.map(({ label, value, mono }) => (
          <div
            className="grid gap-0.5 px-4 py-2.5 sm:grid-cols-[auto_minmax(0,1fr)] sm:items-baseline sm:gap-4"
            key={label}
          >
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd
              className={cn(
                "break-all text-foreground sm:truncate sm:text-right",
                mono ? "font-mono text-xs" : "text-sm font-medium",
              )}
              title={value}
            >
              {value}
            </dd>
          </div>
        ))}
      </dl>
      {error ? <AuthError>{error}</AuthError> : null}
    </AuthMessage>
  );
}
