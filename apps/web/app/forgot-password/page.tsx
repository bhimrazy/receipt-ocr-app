import type { Metadata } from "next";
import { AuthLayout, AuthNotConfiguredCard } from "@/components/auth/auth-layout";
import { ForgotPasswordForm } from "@/components/auth/forgot-password-form";
import { authEnabled } from "@/lib/env";

export const metadata: Metadata = { title: "Reset password" };

// The layout shows the free plan's limit; an admin save also revalidates (revalidatePlanCopy).
export const revalidate = 3600;

export default function ForgotPasswordPage() {
  return (
    <AuthLayout subtitle="Locked out? Send yourself a reset link and get back to your receipts.">
      {authEnabled ? <ForgotPasswordForm /> : <AuthNotConfiguredCard />}
    </AuthLayout>
  );
}
