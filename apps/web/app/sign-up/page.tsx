import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";
import { AuthLayout, AuthNotConfiguredCard } from "@/components/auth/auth-layout";
import { CredentialsForm, type SocialProvider } from "@/components/auth/credentials-form";
import { authEnabled, authEnv } from "@/lib/env";
import { getPlanTable } from "@/lib/plan-limits";
import { callbackErrorMessage } from "@/lib/auth-errors";
import { safeRedirect } from "@/lib/redirect";
import { getSession } from "@/lib/session";
import { redirect as nextRedirect } from "next/navigation";
import { allowance } from "@/lib/plan-copy";

export const metadata: Metadata = pageMetadata({
  title: "Create account",
  description:
    "Create a free ReceiptOCR account. Photograph a receipt or upload a PDF, check what was scanned and export a CSV. No card required.",
  path: "/sign-up",
  index: false,
});

export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<{ redirect?: string | string[]; error?: string | string[] }>;
}) {
  const { redirect, error } = await searchParams;
  const redirectTo = safeRedirect(redirect);

  // Nothing to do here if you're already signed in.
  if (await getSession()) nextRedirect(redirectTo);

  const { free } = await getPlanTable();
  const providers = [authEnv.google ? "google" : null, authEnv.github ? "github" : null].filter(
    Boolean,
  ) as SocialProvider[];

  return (
    <AuthLayout subtitle="Create a free account. Photograph a receipt, check what was scanned, export a CSV.">
      {authEnabled ? (
        <CredentialsForm
          freeAllowance={allowance(free)}
          initialError={callbackErrorMessage(error)}
          mode="sign-up"
          notice={
            redirectTo.startsWith("/accept-invitation/")
              ? ({
                  kind: "info",
                  message:
                    "Use the email address the invitation was sent to, so you can accept it.",
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
