import type { Metadata } from "next";
import { connection } from "next/server";
import { pageMetadata } from "@/lib/seo";
import { AuthLayout, AuthNotConfiguredCard } from "@/components/auth/auth-layout";
import { ForgotPasswordForm } from "@/components/auth/forgot-password-form";
import { authEnabled } from "@/lib/env";

export const metadata: Metadata = pageMetadata({
  title: "Reset password",
  description: "Send yourself a link to reset your ReceiptOCR password.",
  path: "/forgot-password",
  index: false,
});

export default async function ForgotPasswordPage() {
  // Rendered per request: `authEnabled` needs runtime env, which a build-time render doesn't have.
  await connection();
  return (
    <AuthLayout subtitle="Locked out? Send yourself a reset link and get back to your receipts.">
      {authEnabled ? <ForgotPasswordForm /> : <AuthNotConfiguredCard />}
    </AuthLayout>
  );
}
