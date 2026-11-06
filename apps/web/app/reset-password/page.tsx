import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";
import { AuthLayout, AuthNotConfiguredCard } from "@/components/auth/auth-layout";
import { ResetPasswordForm } from "@/components/auth/reset-password-form";
import { authEnabled } from "@/lib/env";

export const metadata: Metadata = pageMetadata({
  title: "Set a new password",
  description: "Choose a new password for your receiptOCR account.",
  path: "/reset-password",
  index: false,
});

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string | string[] }>;
}) {
  const { token } = await searchParams;
  const value = Array.isArray(token) ? token[0] : token;

  return (
    <AuthLayout subtitle="Choose a new password and you're back in.">
      {authEnabled ? <ResetPasswordForm token={value ?? null} /> : <AuthNotConfiguredCard />}
    </AuthLayout>
  );
}
