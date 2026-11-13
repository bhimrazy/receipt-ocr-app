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
import { Effect } from "effect";
import { AboutSettings } from "@/components/about-settings";
import { AccountSettings } from "@/components/account-settings";
import { InstallAppSettings } from "@/components/install-offer";
import { ReceiptReadingSettings } from "@/components/receipt-reading-settings";
import { SettingsList } from "@/components/settings-list";
import { SettingsSection } from "@/components/settings-section";
import { ThemeToggle } from "@/components/theme-toggle";
import { authEnv } from "@/lib/env";
import { getCurrentPlan } from "@/lib/plan-limits";
import { settingsRows } from "@/lib/settings-rows";
import { runtime } from "@/lib/runtime";
import { requireActiveScope, requireSession } from "@/lib/session";
import { count, createDb, eq, member, organization } from "@receipt-ocr/db";
import { buttonVariants } from "@receipt-ocr/ui/components/button";
import { Card } from "@receipt-ocr/ui/components/card";
import { ChevronRight, CreditCard, ShieldCheck, Tags } from "lucide-react";
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
  const [{ plan }, usage, workspace, readers, blocking, protectedAccount] = await Promise.all([
    getCurrentPlan(),
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

  const planSummary = `${plan === "pro" ? "Pro" : "Free"} · ${usage.used} / ${usage.limit} scans`;

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
          planSummary,
          workspaceName: workspace.name,
          protectedAccount,
        })}
      />

      <SettingsSection
        className="max-md:hidden"
        description="Your plan, how many scans are left, and the subscription."
        id="plan-heading"
        title="Plan and billing"
      >
        <Card className="flex flex-wrap items-center gap-3 p-4">
          <span
            aria-hidden="true"
            className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary"
          >
            <CreditCard className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium select-none">Plan and billing</p>
            <p className="font-mono text-xs text-muted-foreground tabular-nums">{planSummary}</p>
          </div>
          <Link
            className={buttonVariants({ variant: "outline", size: "sm" })}
            href="/app/settings/billing"
          >
            {scope.role === "owner" ? "Manage" : "View"}
            <ChevronRight aria-hidden="true" />
          </Link>
        </Card>
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
        <Card className="mt-3 flex flex-wrap items-center gap-3 p-4">
          <span
            aria-hidden="true"
            className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary"
          >
            <Tags className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium select-none">Groups</p>
            <p className="text-xs text-muted-foreground">
              Collect receipts by trip, client or year
            </p>
          </div>
          <Link
            aria-label="Manage groups"
            className={buttonVariants({ variant: "outline", size: "sm" })}
            href="/app/receipts/groups"
          >
            Manage
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
