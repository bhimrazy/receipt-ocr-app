import {
  PageHeader,
  PageHeaderContent,
  PageHeaderDescription,
  PageHeaderTitle,
} from "@/components/page-header";
import {
  providerAvailability,
  receiptReaders,
  Settings,
  workspacesBlockingDeletion,
} from "@receipt-ocr/core";
import { FREE_FAILED_ROUNDS } from "@receipt-ocr/core/plans";
import { Effect } from "effect";
import { AboutSettings } from "@/components/about-settings";
import { AccountSettings, type ResumeStep } from "@/components/account-settings";
import { ReceiptReadingSettings } from "@/components/receipt-reading-settings";
import { SettingsSection } from "@/components/settings-section";
import { UsageMeter } from "@/components/usage-meter";
import { authEnv } from "@/lib/env";
import { getCurrentPlan } from "@/lib/plan-limits";
import { planLabel } from "@/lib/plans";
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

const RESUME_STEPS: readonly ResumeStep[] = ["delete-account", "change-email"];

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
  const resumeStep = RESUME_STEPS.find((step) => step === resume);
  const [{ plan, policy }, usage, workspace, readers, blocking] = await Promise.all([
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

      <SettingsSection
        description={`Receipts reset at 00:00 UTC every day. Your first ${FREE_FAILED_ROUNDS} failed scans a day don't count.`}
        id="plan-heading"
        title="Plan and usage"
      >
        <div className="flex flex-col gap-3">
          <UsageMeter className="p-5" planLabel={planLabel(plan)} usage={usage} />
          <dl className="grid grid-cols-2 gap-3">
            <Card className="p-4">
              <dt className="text-xs text-muted-foreground">Receipts a day</dt>
              <dd className="mt-1 font-mono text-lg tabular-nums">{policy.receiptsPerDay}</dd>
            </Card>
            <Card className="p-4">
              <dt className="text-xs text-muted-foreground">Workspaces you can own</dt>
              <dd className="mt-1 font-mono text-lg tabular-nums">{policy.workspaces}</dd>
            </Card>
          </dl>
        </div>
      </SettingsSection>

      <SettingsSection
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
            <p className="truncate text-sm font-medium">{workspace.name}</p>
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

      <ReceiptReadingSettings readers={readers} />

      <SettingsSection
        description="Two-step sign-in, and the check before important changes."
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
            <p className="text-sm font-medium">
              Two-step sign-in is {session.user.twoFactorEnabled ? "on" : "off"}
            </p>
            <p className="text-xs text-muted-foreground">
              {session.user.twoFactorEnabled
                ? "Your password alone isn't enough to sign in."
                : "Protect your account with a code from an app on your phone."}
            </p>
          </div>
          <Link
            className={buttonVariants({ variant: "outline", size: "sm" })}
            href="/app/settings/security"
          >
            {session.user.twoFactorEnabled ? "Manage" : "Set up"}
            <ChevronRight aria-hidden="true" />
          </Link>
        </Card>
      </SettingsSection>

      <AccountSettings
        blockingWorkspaces={blocking.map((w) => w.name)}
        email={session.user.email}
        emailVerified={session.user.emailVerified}
        name={session.user.name ?? ""}
        resume={resumeStep}
      />

      <AboutSettings />
    </div>
  );
}
