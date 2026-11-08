import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AuthLayout } from "@/components/auth/auth-layout";
import { TwoFactorForm } from "@/components/auth/two-factor-form";
import { supportEmail } from "@/lib/env";
import { DEFAULT_REDIRECT, safeRedirect } from "@/lib/redirect";
import { pageMetadata } from "@/lib/seo";
import { getSession } from "@/lib/session";

export const metadata: Metadata = pageMetadata({
  title: "Enter your code",
  description: "The second step of signing in to ReceiptOCR.",
  path: "/sign-in/two-factor",
  index: false,
});

/** Better Auth's signed challenge cookie from the password step (`__Secure-` prefixed over https). */
const hasChallenge = (names: string[]) => names.some((name) => /(^|\.)two_factor$/.test(name));

export default async function TwoFactorPage({
  searchParams,
}: {
  searchParams: Promise<{ redirect?: string | string[] }>;
}) {
  const redirectTo = safeRedirect((await searchParams).redirect);
  if (await getSession()) redirect(redirectTo);
  const names = (await cookies()).getAll().map((cookie) => cookie.name);
  if (!hasChallenge(names)) {
    redirect(
      redirectTo === DEFAULT_REDIRECT
        ? "/sign-in"
        : `/sign-in?redirect=${encodeURIComponent(redirectTo)}`,
    );
  }
  return (
    <AuthLayout subtitle="One more step: the code from your authenticator app.">
      <TwoFactorForm redirectTo={redirectTo} supportEmail={supportEmail} />
    </AuthLayout>
  );
}
