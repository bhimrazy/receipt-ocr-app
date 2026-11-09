import {
  PageHeader,
  PageHeaderContent,
  PageHeaderDescription,
  PageHeaderTitle,
} from "@/components/page-header";
import {
  hasStrongFactor,
  providerAvailability,
  receiptReaders,
  Settings,
  workspacesBlockingDeletion,
} from "@receipt-ocr/core";
import { FREE_FAILED_ROUNDS } from "@receipt-ocr/core/plans";
import { Effect } from "effect";
import { AboutSettings } from "@/components/about-settings";
import { AccountSettings } from "@/components/account-settings";
import { InstallAppSettings } from "@/components/install-offer";
import { ReceiptReadingSettings } from "@/components/receipt-reading-settings";
import { SettingsList } from "@/components/settings-list";
import { SettingsSection } from "@/components/settings-section";
import { ThemeToggle } from "@/components/theme-toggle";
import { UsageMeter } from "@/components/usage-meter";
import { authEnv } from "@/lib/env";
import { getAccountPlan, getCurrentPlan } from "@/lib/plan-limits";
import { SEPARATE_UPGRADE } from "@/lib/plan-copy";
import { planLabel } from "@/lib/plans";
import { settingsRows } from "@/lib/settings-rows";
import { runtime } from "@/lib/runtime";
import { requireActiveScope, requireSession } from "@/lib/session";
import { count, createDb, eq, member, organization } from "@receipt-ocr/db";
import { buttonVariants } from "@receipt-ocr/ui/components/button";
import { Card } from "@receipt-ocr/ui/components/card";
import { ChevronRight, ShieldCheck } from "lucide-react";
import Link from "next/link";
import type { Metadata } from "next";
import { getUsageSummary } from "@/lib/receipts";
import { logPageRender } from "@/lib/page-event";

export const metadata: Metadata = { title: "Settings" };

async function loadWorkspace(organizationId: string) {
  const db = createDb(authEnv.databaseUrl!);
  const [[org], [row]] = await Promise.all([
    db
      .select({ name: organization.name })
      .from(organization)
      .where(eq(organization.id, organizationId))
      .limit(1),
    db.select({ value: count() }).from(member).where(eq(member.organizationId, organizationId)),
  ]);
  return { name: org?.name ?? "This workspace", members: Number(row?.value ?? 0) };
}

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ resume?: string | string[] }>;
}) {
  logPageRender("/app/settings");
  const [scope, session, { resume }] = await Promise.all([
    requireActiveScope(),
    requireSession(),
    searchParams,
  ]);
  const resumeStep = resume === "delete-account" ? resume : undefined;
  const [{ plan, policy }, account, usage, workspace, readers, blocking, protectedAccount] =
    await Promise.all([
      getCurrentPlan(),
      getAccountPlan(),
      getUsageSummary(),
      loadWorkspace(scope.organizationId),
      runtime.runPromise(
        Effect.zipWith(
          Effect.flatMap(Settings, (settings) => settings.ocr),
          providerAvailability,
          receiptReaders,
        ),
      ),
      runtime.runPromise(workspacesBlockingDeletion(session.user.id)),
      runtime.runPromise(hasStrongFactor(session.user.id)),
    ]);

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader className="mb-8">
        <PageHeaderContent>
          <PageHeaderTitle>Settings</PageHeaderTitle>
          <PageHeaderDescription>
            Your plan, your workspace, how receipts are scanned and your account.
          </PageHeaderDescription>
        </PageHeaderContent>
      </PageHeader>

      {/* Phones: these four sections become rows that open their sub-page or a sheet. */}
      <SettingsList
        className="mb-8"
        rows={settingsRows({
          planLabel: planLabel(plan),
          workspaceName: workspace.name,
          protectedAccount,
        })}
      />

      <SettingsSection
        className="max-md:hidden"
        description={
          policy.scope === "workspace"
            ? `This workspace's scans are shared by its members. Limits reset at 00:00 UTC: daily, and on the 1st of each month. The first ${FREE_FAILED_ROUNDS} failed scans don't count.`
            : `Your scans count across every Free workspace you use. Limits reset at 00:00 UTC: daily, and on the 1st of each month. Your first ${FREE_FAILED_ROUNDS} failed scans don't count.`
        }
        id="plan-heading"
        title="Plan and usage"
      >
        <div className="flex flex-col gap-3">
          <UsageMeter className="p-5" planLabel={planLabel(plan)} usage={usage} />
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Card className="p-4">
              <dt className="text-xs text-muted-foreground">
                Scans a day{policy.scope === "workspace" ? ", this workspace" : ", you"}
              </dt>
              <dd className="mt-1 font-mono text-lg tabular-nums">{policy.receiptsPerDay}</dd>
            </Card>
            {policy.receiptsPerMonth !== null ? (
              <Card className="p-4">
                <dt className="text-xs text-muted-foreground">
                  Scans a month{policy.scope === "workspace" ? ", this workspace" : ", you"}
                </dt>
                <dd className="mt-1 font-mono text-lg tabular-nums">{policy.receiptsPerMonth}</dd>
              </Card>
            ) : null}
            <Card className="p-4">
              <dt className="text-xs text-muted-foreground">Workspaces you can own</dt>
              <dd className="mt-1 font-mono text-lg tabular-nums">{account.policy.workspaces}</dd>
            </Card>
          </dl>
          <Card className="flex flex-wrap items-center gap-3 p-4">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium select-none">Billing</p>
              <p className="text-xs text-muted-foreground">
                {plan === "pro"
                  ? "This workspace is on Pro."
                  : scope.role === "owner" && account.plan === "pro"
                    ? SEPARATE_UPGRADE
                    : "Upgrade this workspace to Pro for more scans, shared by its members."}
              </p>
            </div>
            <Link
              className={buttonVariants({ variant: "outline", size: "sm" })}
              href="/app/settings/billing"
            >
              {plan === "pro" ? "Manage" : "See plans"}
              <ChevronRight aria-hidden="true" />
            </Link>
          </Card>
        </div>
      </SettingsSection>

      <SettingsSection
        className="max-md:hidden"
        description="Everyone in a workspace shares its receipts."
        id="workspace-heading"
        title="Workspace"
      >
        <Card className="flex flex-wrap items-center gap-3 p-4">
          <span
            aria-hidden="true"
            className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/15 font-mono text-sm font-semibold text-primary"
          >
            {(workspace.name.trim() || "?").charAt(0).toUpperCase()}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium select-none">{workspace.name}</p>
            <p className="text-xs text-muted-foreground">
              {workspace.members} {workspace.members === 1 ? "member" : "members"} · Your role:{" "}
              {scope.role.charAt(0).toUpperCase()}
              {scope.role.slice(1)}
            </p>
          </div>
          <Link
            className={buttonVariants({ variant: "outline", size: "sm" })}
            href="/app/settings/members"
          >
            Members
            <ChevronRight aria-hidden="true" />
          </Link>
        </Card>
      </SettingsSection>

      <SettingsSection
        className="max-md:hidden"
        description="Match your device, or choose one. Saved on this device."
        id="appearance-heading"
        title="Appearance"
      >
        <ThemeToggle aria-labelledby="appearance-heading" className="w-full sm:w-auto" labels />
      </SettingsSection>

      <ReceiptReadingSettings readers={readers} />

      <SettingsSection
        className="max-md:hidden"
        description="Passkeys, two-step sign-in and the check before important changes."
        id="security-heading"
        title="Security"
      >
        <Card className="flex flex-wrap items-center gap-3 p-4">
          <span
            aria-hidden="true"
            className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary"
          >
            <ShieldCheck className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium select-none">
              {protectedAccount
                ? "Your account is protected"
                : "Add a second check when you sign in"}
            </p>
            <p className="text-xs text-muted-foreground">
              {protectedAccount
                ? "Signing in needs more than a password."
                : "A passkey or an app code, so a stolen password alone can't get in."}
            </p>
          </div>
          <Link
            className={buttonVariants({ variant: "outline", size: "sm" })}
            href="/app/settings/security"
          >
            {protectedAccount ? "Manage" : "Set up"}
            <ChevronRight aria-hidden="true" />
          </Link>
        </Card>
      </SettingsSection>

      <AccountSettings
        blockingWorkspaces={blocking.soleOwner.map((w) => w.name)}
        subscribedWorkspaces={blocking.subscribed.map((w) => w.name)}
        email={session.user.email}
        emailVerified={session.user.emailVerified}
        name={session.user.name ?? ""}
        resume={resumeStep}
      />

      <AboutSettings />

      {/* Last: it appears only once the browser offers an install, so nothing below it shifts. */}
      <InstallAppSettings />
    </div>
  );
}
