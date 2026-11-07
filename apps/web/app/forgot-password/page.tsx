import type { Metadata } from "next";
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

// The layout shows the free plan's limit; an admin save also revalidates (revalidatePlanCopy).
export const revalidate = 3600;

export default function ForgotPasswordPage() {
  return (
    <AuthLayout subtitle="Locked out? Send yourself a reset link and get back to your receipts.">
      {authEnabled ? <ForgotPasswordForm /> : <AuthNotConfiguredCard />}
    </AuthLayout>
  );
}
