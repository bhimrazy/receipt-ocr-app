"use client";

import { Button, buttonVariants } from "@receipt-ocr/ui/components/button";
import { Check, Loader2, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { authClient } from "@/lib/auth-client";

function roleLabel(role: string) {
  const lower = role.toLowerCase();
  return `${/^[aeiou]/.test(lower) ? "an" : "a"} ${lower}`;
}

type InvitationDetails = Awaited<
  ReturnType<typeof authClient.organization.getInvitation>
>["data"];

export function AcceptInvitation({ invitationId }: { invitationId: string }) {
  const { data: session, isPending: sessionPending } = authClient.useSession();
  const router = useRouter();

  const [invitation, setInvitation] = useState<InvitationDetails>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [action, setAction] = useState<"accept" | "reject" | null>(null);

  const signedIn = Boolean(session);

  // Redirect unauthenticated visitors to sign-in, returning here afterwards.
  useEffect(() => {
    if (sessionPending || signedIn) return;
    const redirect = encodeURIComponent(`/accept-invitation/${invitationId}`);
    router.replace(`/sign-in?redirect=${redirect}`);
  }, [sessionPending, signedIn, invitationId, router]);

  // Load invitation details once signed in.
  useEffect(() => {
    if (!signedIn) return;
    let cancelled = false;
    (async () => {
      const { data, error: fetchError } = await authClient.organization.getInvitation({
        query: { id: invitationId },
      });
      if (cancelled) return;
      if (fetchError) {
        setLoadFailed(true);
      } else {
        setInvitation(data);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [signedIn, invitationId]);

  async function handleAccept() {
    setAction("accept");
    setError(null);
    const { data, error: acceptError } = await authClient.organization.acceptInvitation({ invitationId });
    if (acceptError || !data) {
      setError(acceptError?.message ?? "Couldn't accept the invite. Try again.");
      setAction(null);
      return;
    }
    // Make the joined workspace active before dropping the user into the app.
    if (data.invitation?.organizationId) {
      await authClient.organization.setActive({ organizationId: data.invitation.organizationId });
    }
    router.push("/app/upload");
    router.refresh();
  }

  async function handleReject() {
    setAction("reject");
    setError(null);
    const { error: rejectError } = await authClient.organization.rejectInvitation({ invitationId });
    if (rejectError) {
      setError(rejectError.message ?? "Couldn't decline the invite. Try again.");
      setAction(null);
      return;
    }
    router.push("/app/upload");
  }

  if (sessionPending || !signedIn || loading) {
    return (
      <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground" role="status">
        <Loader2 aria-hidden="true" className="size-4 animate-spin" />
        {sessionPending || !signedIn ? "Checking your sign-in…" : "Loading your invite…"}
      </div>
    );
  }

  if (loadFailed || !invitation) {
    return (
      <div className="text-center">
        <h2 className="text-2xl font-semibold tracking-tight">This invite can&apos;t be used</h2>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          It may have expired or been cancelled. Ask the person who invited you to send a new one.
        </p>
        <Link className={buttonVariants({ variant: "outline", className: "mt-6 w-full" })} href="/app/upload">
          Go to the app
        </Link>
      </div>
    );
  }

  const orgName = invitation.organizationName ?? "a workspace";
  const busy = action !== null;
  const wrongAccount = Boolean(session?.user.email && invitation.email && session.user.email !== invitation.email);

  return (
    <div className="text-center">
      <h2 className="text-2xl font-semibold tracking-tight">You&apos;re invited</h2>
      <p className="mt-3 text-sm leading-6 text-muted-foreground">
        Join <span className="font-medium text-foreground">{orgName}</span>
        {invitation.role ? <> as {roleLabel(invitation.role)}</> : null} to see and add its receipts.
      </p>
      {wrongAccount ? (
        <p className="mt-4 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-left text-sm text-warning">
          This invite is for {invitation.email}, but you&apos;re signed in as {session?.user.email}. Sign in with the
          invited email to accept it.
        </p>
      ) : null}
      {error ? (
        <p
          className="mt-4 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-left text-sm text-destructive"
          role="alert"
        >
          {error}
        </p>
      ) : null}
      <div className="mt-6 flex flex-col gap-2.5">
        <Button className="w-full" disabled={busy} onClick={handleAccept}>
          {action === "accept" ? <Loader2 aria-hidden="true" className="animate-spin" /> : <Check aria-hidden="true" />}
          Accept invite
        </Button>
        <Button className="w-full" disabled={busy} onClick={handleReject} variant="outline">
          {action === "reject" ? <Loader2 aria-hidden="true" className="animate-spin" /> : <X aria-hidden="true" />}
          Decline
        </Button>
      </div>
    </div>
  );
}
