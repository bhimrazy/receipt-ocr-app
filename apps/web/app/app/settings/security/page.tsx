import type { Metadata } from "next";
import { headers } from "next/headers";
import { Alert } from "@receipt-ocr/ui/components/alert";
import {
  PageHeader,
  PageHeaderContent,
  PageHeaderDescription,
  PageHeaderTitle,
} from "@/components/page-header";
import { TwoFactorCard } from "@/components/security/two-factor-card";
import { SettingsBreadcrumb } from "@/components/settings-breadcrumb";
import { SettingsSection } from "@/components/settings-section";
import { auth } from "@/lib/auth";
import { logPageRender } from "@/lib/page-event";
import { isAdmin, requireSession } from "@/lib/session";

export const metadata: Metadata = { title: "Security" };

export default async function SecurityPage({
  searchParams,
}: {
  searchParams: Promise<{ required?: string | string[] }>;
}) {
  logPageRender("/app/settings/security");
  const session = await requireSession();
  const [{ required }, accounts] = await Promise.all([
    searchParams,
    auth.api.listUserAccounts({ headers: await headers() }),
  ]);
  const hasPassword = accounts.some((account) => account.providerId === "credential");
  const enabled = Boolean(session.user.twoFactorEnabled);
  const impersonating = Boolean(session.session.impersonatedBy);

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader className="mb-8">
        <PageHeaderContent>
          <SettingsBreadcrumb current="Security" />
          <PageHeaderTitle>Security</PageHeaderTitle>
          <PageHeaderDescription>
            How you sign in, and the extra check before important changes.
          </PageHeaderDescription>
        </PageHeaderContent>
      </PageHeader>

      {required === "admin" && isAdmin(session) && !enabled ? (
        <Alert className="mb-6" variant="warning">
          Admin accounts must use two-step sign-in. Set up an authenticator app below, then open
          Admin again.
        </Alert>
      ) : null}

      <SettingsSection
        description="A code from an app on your phone, on top of your password. Also used to confirm it's you before important changes."
        id="two-factor-heading"
        title="Two-step sign-in"
      >
        {impersonating ? (
          <Alert variant="warning">
            You&apos;re signed in as this user, so you can&apos;t change their sign-in methods.
          </Alert>
        ) : (
          <TwoFactorCard email={session.user.email} enabled={enabled} hasPassword={hasPassword} />
        )}
      </SettingsSection>
    </div>
  );
}
