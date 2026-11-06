import { AcceptInvitation } from "@/components/auth/accept-invitation";
import { AuthLayout, AuthNotConfiguredCard } from "@/components/auth/auth-layout";
import { authEnabled } from "@/lib/env";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Accept invitation",
  description: "Accept an invitation to share receipts in a receiptOCR workspace.",
  robots: { index: false, follow: true },
};

export default async function AcceptInvitationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <AuthLayout subtitle="Join a workspace to share receipts with your team.">
      {authEnabled ? <AcceptInvitation invitationId={id} /> : <AuthNotConfiguredCard />}
    </AuthLayout>
  );
}
