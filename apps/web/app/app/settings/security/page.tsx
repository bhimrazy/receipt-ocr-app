import type { Metadata } from "next";
import { headers } from "next/headers";
import {
  canRemoveAccount,
  canRemovePasskey,
  isStrongFactor,
  loadSignInMethods,
  PROVIDER_LABELS,
  signInMethodCount,
} from "@receipt-ocr/core";
import { Alert } from "@receipt-ocr/ui/components/alert";
import { Badge } from "@receipt-ocr/ui/components/badge";
import {
  PageHeader,
  PageHeaderContent,
  PageHeaderDescription,
  PageHeaderTitle,
} from "@/components/page-header";
import { PasskeysCard, type PasskeyRow } from "@/components/security/passkeys-card";
import { SecurityChecklist } from "@/components/security/security-checklist";
import { SignInMethodsCard, type ProviderRow } from "@/components/security/sign-in-methods-card";
import { TwoFactorCard } from "@/components/security/two-factor-card";
import { SettingsBreadcrumb } from "@/components/settings-breadcrumb";
import { SettingsSection } from "@/components/settings-section";
import { auth } from "@/lib/auth";
import { configuredProviders } from "@/lib/auth-accounts";
import { logPageRender } from "@/lib/page-event";
import { passkeyLabel } from "@/lib/passkey-label";
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
    // Factor endpoints refuse an impersonation session; the read-only card shows the count instead.
    impersonating ? [] : auth.api.listPasskeys({ headers: requestHeaders }),
  ]);
  // Public metadata only: never the public key or credential id.
  const passkeys: PasskeyRow[] = keys.map((key) => ({
    id: key.id,
    label: passkeyLabel(key),
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

      {impersonating ? (
        <Alert className="mb-6" variant="warning">
          You&apos;re viewing {session.user.email}&apos;s security settings as an admin. You can see
          them, but not change them.
        </Alert>
      ) : null}

      {params.required === "admin" && isAdmin(session) && !enabled && passkeys.length === 0 ? (
        <Alert className="mb-6" variant="warning">
          Admin accounts must use two-step sign-in. Add a passkey or set up an authenticator app
          below, then open Admin again.
        </Alert>
      ) : null}

      <SecurityChecklist
        email={session.user.email}
        emailVerified={session.user.emailVerified}
        methods={methods ? signInMethodCount(methods, configured) : 0}
        readOnly={impersonating}
        strongFactor={isStrongFactor({ twoFactorEnabled: enabled, passkeys: passkeyCount })}
      />

      <SettingsSection
        description="Your password and the accounts you can sign in with."
        id="sign-in-methods-heading"
        title="Sign-in methods"
      >
        <SignInMethodsCard
          email={session.user.email}
          hasPassword={hasPassword}
          outcome={outcome}
          providers={providers}
          readOnly={impersonating}
        />
      </SettingsSection>

      <SettingsSection
        badge={
          passkeyCount > 0 ? (
            <Badge variant="success">{passkeyCount} added</Badge>
          ) : (
            <Badge variant="secondary">None</Badge>
          )
        }
        description="Sign in with your fingerprint, face or device PIN instead of a password."
        id="passkeys-heading"
        title="Passkeys"
      >
        <PasskeysCard
          count={passkeyCount}
          lastWayIn={methods ? !canRemovePasskey(methods, configured) : false}
          passkeys={passkeys}
          readOnly={impersonating}
        />
      </SettingsSection>

      <SettingsSection
        badge={
          enabled ? <Badge variant="success">On</Badge> : <Badge variant="secondary">Off</Badge>
        }
        description="A code from an app on your phone, on top of your password."
        id="two-factor-heading"
        title="Two-step sign-in"
      >
        <TwoFactorCard
          email={session.user.email}
          enabled={enabled}
          hasPassword={hasPassword}
          readOnly={impersonating}
        />
      </SettingsSection>
    </div>
  );
}
