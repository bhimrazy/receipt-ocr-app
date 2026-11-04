import type { Metadata } from "next";
import { AuthLayout, AuthNotConfiguredCard } from "@/components/auth/auth-layout";
import { CredentialsForm, type SocialProvider } from "@/components/auth/credentials-form";
import { authEnabled, authEnv } from "@/lib/env";
import { callbackErrorMessage } from "@/lib/auth-errors";
import { safeRedirect } from "@/lib/redirect";
import { getSession } from "@/lib/session";
import { redirect as nextRedirect } from "next/navigation";

export const metadata: Metadata = { title: "Sign in", robots: { index: false, follow: true } };

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{
    redirect?: string | string[];
    reset?: string | string[];
    error?: string | string[];
  }>;
}) {
  const { redirect, reset, error } = await searchParams;
  const redirectTo = safeRedirect(redirect);

  // Nothing to do here if you're already signed in.
  if (await getSession()) nextRedirect(redirectTo);

  const providers = [authEnv.google ? "google" : null, authEnv.github ? "github" : null].filter(
    Boolean,
  ) as SocialProvider[];

  return (
    <AuthLayout subtitle="Sign in to upload receipts, check what was read and export a CSV.">
      {authEnabled ? (
        <CredentialsForm
          mode="sign-in"
          initialError={callbackErrorMessage(error)}
          notice={
            reset
              ? ({
                  kind: "success",
                  message: "Password updated. Sign in with your new password.",
                } as const)
              : redirectTo.startsWith("/accept-invitation/")
                ? ({
                    kind: "info",
                    message:
                      "Sign in to accept your invitation. No account yet? Create one with the email address the invitation was sent to.",
                  } as const)
                : undefined
          }
          providers={providers}
          redirectTo={redirectTo}
        />
      ) : (
        <AuthNotConfiguredCard />
      )}
    </AuthLayout>
  );
}
