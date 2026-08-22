import { AcceptInvitation } from "@/components/accept-invitation";
import { AuthLayout, AuthNotConfiguredCard } from "@/components/auth/auth-layout";
import { authEnabled } from "@/lib/env";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Accept invitation" };

export default async function AcceptInvitationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <AuthLayout subtitle="Accept your invitation to join a workspace and start turning receipts into structured data.">
      {authEnabled ? (
        <div className="w-full rounded-2xl border border-white/10 bg-card/80 p-8 shadow-2xl backdrop-blur-xl">
          <AcceptInvitation invitationId={id} />
        </div>
      ) : (
        <AuthNotConfiguredCard />
      )}
    </AuthLayout>
  );
}
