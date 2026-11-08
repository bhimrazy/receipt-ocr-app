import type { Metadata } from "next";
import { headers } from "next/headers";
import {
  canRemoveAccount,
  loadSignInMethods,
  PROVIDER_LABELS,
  signInMethodCount,
} from "@receipt-ocr/core";
import { Alert } from "@receipt-ocr/ui/components/alert";
import { Skeleton } from "@receipt-ocr/ui/components/skeleton";
import { Suspense } from "react";
import {
  PageHeader,
  PageHeaderContent,
  PageHeaderDescription,
  PageHeaderTitle,
} from "@/components/page-header";
import { LinkedIdentity } from "@/components/security/linked-identity";
import { PasskeysCard, type PasskeyRow } from "@/components/security/passkeys-card";
import { SecurityChecklist } from "@/components/security/security-checklist";
import { SignInMethodsCard, type ProviderRow } from "@/components/security/sign-in-methods-card";
import { TwoFactorCard } from "@/components/security/two-factor-card";
import { getAuthenticatorName } from "@better-auth/passkey";
import { SettingsBreadcrumb } from "@/components/settings-breadcrumb";
import { SettingsSection } from "@/components/settings-section";
import { auth } from "@/lib/auth";
import { configuredProviders } from "@/lib/auth-accounts";
import { logPageRender } from "@/lib/page-event";
import { runtime } from "@/lib/runtime";
import { linkOutcome } from "@/lib/sign-in-methods";
import { isAdmin, requireSession } from "@/lib/session";

export const metadata: Metadata = { title: "Security" };

type Params = {
  required?: string | string[];
  link?: string | string[];
  linked?: string | string[];
  error?: string | string[];
};

export default async function SecurityPage({ searchParams }: { searchParams: Promise<Params> }) {
  logPageRender("/app/settings/security");
  const session = await requireSession();
  const requestHeaders = await headers();
  const impersonating = Boolean(session.session.impersonatedBy);
  const [params, methods, keys] = await Promise.all([
    searchParams,
    runtime.runPromise(loadSignInMethods(session.user.id)),
    // Factor endpoints refuse an impersonation session, and the cards are hidden there anyway.
    impersonating ? [] : auth.api.listPasskeys({ headers: requestHeaders }),
  ]);
  // Public metadata only: never the public key or credential id.
  const passkeys: PasskeyRow[] = keys.map((key) => ({
    id: key.id,
    label: key.name || getAuthenticatorName(key.aaguid) || "Passkey",
    synced: key.backedUp,
    createdAt: new Date(key.createdAt).toISOString(),
  }));
  const accounts = methods?.accounts ?? [];
  const passkeyCount = methods?.passkeys ?? passkeys.length;
  const hasPassword = accounts.some((a) => a.providerId === "credential" && a.hasPassword);
  const enabled = Boolean(session.user.twoFactorEnabled);
  const configured = configuredProviders();
  const providers: ProviderRow[] = configured.map((id) => {
    const linked = accounts.find((a) => a.providerId === id);
    return {
      id,
      label: PROVIDER_LABELS[id],
      accountId: linked?.id ?? null,
      connectedAt: linked ? linked.createdAt.toISOString() : null,
      canDisconnect: Boolean(linked && methods && canRemoveAccount(methods, linked.id, configured)),
    };
  });
  const identities = Object.fromEntries(
    providers.flatMap((p) =>
      p.accountId && !impersonating
        ? [
            [
              p.id,
              <Suspense fallback={<Skeleton className="h-4 w-40" />} key={p.id}>
                <LinkedIdentity accountId={p.accountId} provider={p.id} />
              </Suspense>,
            ],
          ]
        : [],
    ),
  );
  const outcome = linkOutcome(params, PROVIDER_LABELS, session.user.email);

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

      {params.required === "admin" && isAdmin(session) && !enabled && passkeys.length === 0 ? (
        <Alert className="mb-6" variant="warning">
          Admin accounts must use two-step sign-in. Add a passkey or set up an authenticator app
          below, then open Admin again.
        </Alert>
      ) : null}

      <section aria-label="Account security checklist" className="mb-8">
        <SecurityChecklist
          email={session.user.email}
          emailVerified={session.user.emailVerified}
          methods={methods ? signInMethodCount(methods, configured) : 0}
          readOnly={impersonating}
          strongFactor={enabled || passkeyCount > 0}
        />
      </section>

      <SettingsSection
        description="Every way into your account. Keep at least two, so losing one doesn't lock you out."
        id="sign-in-methods-heading"
        title="Sign-in methods"
      >
        <SignInMethodsCard
          email={session.user.email}
          hasPassword={hasPassword}
          identities={identities}
          outcome={outcome}
          passkeys={passkeyCount}
          providers={providers}
          readOnly={impersonating}
        />
      </SettingsSection>

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
