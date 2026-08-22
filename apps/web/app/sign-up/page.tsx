import type { Metadata } from "next";
import { AuthLayout, AuthNotConfiguredCard } from "@/components/auth/auth-layout";
import { CredentialsForm, type SocialProvider } from "@/components/auth/credentials-form";
import { authEnabled, authEnv } from "@/lib/env";

export const metadata: Metadata = { title: "Create account" };

/** Only allow internal, single-slash paths as post-auth redirects (no open redirects). */
function safeRedirect(value: string | string[] | undefined): string {
  const raw = Array.isArray(value) ? value[0] : value;
  if (raw && raw.startsWith("/") && !raw.startsWith("//")) return raw;
  return "/app/upload";
}

export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<{ redirect?: string | string[] }>;
}) {
  const { redirect } = await searchParams;
  const redirectTo = safeRedirect(redirect);

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
