"use client";

import { Button } from "@receipt-ocr/ui/components/button";
import { Check, Loader2, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { authClient } from "@/lib/auth-client";

type InvitationDetails = Awaited<ReturnType<typeof authClient.organization.getInvitation>>["data"];

export function AcceptInvitation({ invitationId }: { invitationId: string }) {
  const { data: session, isPending: sessionPending } = authClient.useSession();
  const router = useRouter();

  const [invitation, setInvitation] = useState<InvitationDetails>(null);
  const [loading, setLoading] = useState(true);
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
      const { data, error: loadError } = await authClient.organization.getInvitation({
        query: { id: invitationId },
      });
      if (cancelled) return;
      if (loadError) {
        setError(loadError.message ?? "This invitation is invalid or has expired.");
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
    const { data, error: acceptError } = await authClient.organization.acceptInvitation({
      invitationId,
    });
    if (acceptError || !data) {
      setError(acceptError?.message ?? "Could not accept this invitation.");
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
      setError(rejectError.message ?? "Could not decline this invitation.");
      setAction(null);
      return;
    }
    router.push("/app/upload");
  }

  if (sessionPending || (!signedIn && !error)) {
    return (
      <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        Checking your session…
      </div>
    );
  }

  if (loading && !error) {
    return (
      <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        Loading invitation…
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center">
        <p
          className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400"
          role="alert"
        >
          {error}
        </p>
        <Button asChild className="mt-6" variant="outline">
          <Link href="/app/upload">Go to app</Link>
        </Button>
      </div>
    );
  }

  const orgName = invitation?.organizationName ?? "a workspace";
  const busy = action !== null;

  return (
    <div className="text-center">
      <h2 className="text-2xl font-semibold tracking-tight">You&apos;re invited</h2>
      <p className="mt-3 text-sm leading-6 text-muted-foreground">
        You&apos;ve been invited to join{" "}
        <span className="font-medium text-foreground">{orgName}</span>
        {invitation?.role ? <> as {invitation.role}</> : null}.
      </p>
      {session?.user.email && invitation?.email && session.user.email !== invitation.email ? (
        <p className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
          This invite was sent to {invitation.email}, but you&apos;re signed in as{" "}
          {session.user.email}. Sign in with the invited email to accept.
        </p>
      ) : null}
      <div className="mt-6 flex flex-col gap-2.5">
        <Button className="w-full" disabled={busy} onClick={handleAccept}>
          {action === "accept" ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Check className="size-4" />
          )}
          Accept invitation
        </Button>
        <Button className="w-full" disabled={busy} onClick={handleReject} variant="outline">
          {action === "reject" ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <X className="size-4" />
          )}
          Decline
        </Button>
      </div>
    </div>
  );
}
