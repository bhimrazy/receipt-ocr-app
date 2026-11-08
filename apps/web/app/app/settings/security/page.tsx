import type { Metadata } from "next";
import { headers } from "next/headers";
import { Alert } from "@receipt-ocr/ui/components/alert";
import {
  PageHeader,
  PageHeaderContent,
  PageHeaderDescription,
  PageHeaderTitle,
} from "@/components/page-header";
import { PasskeysCard, type PasskeyRow } from "@/components/security/passkeys-card";
import { TwoFactorCard } from "@/components/security/two-factor-card";
import { getAuthenticatorName } from "@better-auth/passkey";
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
  const requestHeaders = await headers();
  const [{ required }, accounts, keys] = await Promise.all([
    searchParams,
    auth.api.listUserAccounts({ headers: requestHeaders }),
    // Factor endpoints refuse an impersonation session, and the cards are hidden there anyway.
    session.session.impersonatedBy ? [] : auth.api.listPasskeys({ headers: requestHeaders }),
  ]);
  // Public metadata only: never the public key or credential id.
  const passkeys: PasskeyRow[] = keys.map((key) => ({
    id: key.id,
    label: key.name || getAuthenticatorName(key.aaguid) || "Passkey",
    synced: key.backedUp,
    createdAt: new Date(key.createdAt).toISOString(),
  }));
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

      {required === "admin" && isAdmin(session) && !enabled && passkeys.length === 0 ? (
        <Alert className="mb-6" variant="warning">
          Admin accounts must use two-step sign-in. Add a passkey or set up an authenticator app
          below, then open Admin again.
        </Alert>
      ) : null}

      <SettingsSection
        description="Sign in without a password, using the lock on your phone or computer."
        id="passkeys-heading"
        title="Passkeys"
      >
        {impersonating ? (
          <Alert variant="warning">
            You&apos;re signed in as this user, so you can&apos;t change their sign-in methods.
          </Alert>
        ) : (
          <PasskeysCard passkeys={passkeys} />
        )}
      </SettingsSection>

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
