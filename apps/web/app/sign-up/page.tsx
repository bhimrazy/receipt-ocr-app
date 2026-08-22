import type { Metadata } from "next";
import { AuthLayout, AuthNotConfiguredCard } from "@/components/auth/auth-layout";
import { CredentialsForm, type SocialProvider } from "@/components/auth/credentials-form";
import { authEnabled, authEnv } from "@/lib/env";
import { safeRedirect } from "@/lib/redirect";
import { getSession } from "@/lib/session";
import { redirect as nextRedirect } from "next/navigation";

export const metadata: Metadata = { title: "Create account" };

export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<{ redirect?: string | string[] }>;
}) {
  const { redirect } = await searchParams;
  const redirectTo = safeRedirect(redirect);

  // Nothing to do here if you're already signed in.
  if (await getSession()) nextRedirect(redirectTo);

  const providers = [
    authEnv.google ? "google" : null,
    authEnv.github ? "github" : null,
  ].filter(Boolean) as SocialProvider[];

  return (
    <AuthLayout subtitle="Create a free account and turn your first receipt into structured data in seconds.">
      {authEnabled ? (
        <CredentialsForm mode="sign-up" providers={providers} redirectTo={redirectTo} />
      ) : (
        <AuthNotConfiguredCard />
      )}
    </AuthLayout>
  );
}
