import {
  PageHeader,
  PageHeaderContent,
  PageHeaderDescription,
  PageHeaderTitle,
} from "@/components/page-header";
import { InviteForm } from "@/components/members/invite-form";
import { MembersTable } from "@/components/members/members-table";
import { PendingInvites } from "@/components/members/pending-invites";
import { toRole } from "@/components/members/roles";
import { auth } from "@/lib/auth";
import { logger } from "@/lib/log";
import { requireActiveScope } from "@/lib/session";
import { Alert } from "@receipt-ocr/ui/components/alert";
import { headers } from "next/headers";
import { ChevronRight } from "lucide-react";
import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Members" };

async function loadWorkspace(organizationId: string) {
  try {
    // Checks membership too: a non-member gets FORBIDDEN.
    const org = await auth.api.getFullOrganization({
      headers: await headers(),
      query: { organizationId },
    });
    if (!org) return null;
    return {
      name: org.name,
      members: org.members.map((m) => ({
        id: m.id,
        userId: m.userId,
        role: toRole(m.role),
        name: m.user.name ?? "",
        email: m.user.email,
      })),
      invitations: org.invitations
        .filter((i) => i.status === "pending")
        .map((i) => ({ id: i.id, email: i.email, role: toRole(i.role), expiresAt: i.expiresAt })),
    };
  } catch (error) {
    logger.error({ event: "members.load_failed", message: String(error) });
    return null;
  }
}

export default async function MembersPage() {
  const scope = await requireActiveScope();
  const workspace = await loadWorkspace(scope.organizationId);
  const canManage = scope.role === "owner" || scope.role === "admin";

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader className="mb-8">
        <PageHeaderContent>
          <nav aria-label="Breadcrumb" className="mb-3">
            <ol className="flex items-center gap-1 text-xs text-muted-foreground">
              <li>
                <Link
                  className="inline-flex items-center rounded-md py-1 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring max-md:min-h-11"
                  href="/app/settings"
                >
                  Settings
                </Link>
              </li>
              <li aria-hidden="true">
                <ChevronRight className="size-3.5" />
              </li>
              <li aria-current="page" className="text-foreground">
                Members
              </li>
            </ol>
          </nav>
          <PageHeaderTitle>Workspace members</PageHeaderTitle>
          <PageHeaderDescription>
            Invite teammates and choose what they can do. Everyone in a workspace shares its
            receipts.
          </PageHeaderDescription>
        </PageHeaderContent>
      </PageHeader>

      {workspace ? (
        // Keyed so form and dialog state reset when the active workspace changes.
        <div className="space-y-5" key={scope.organizationId}>
          <MembersTable
            canManage={canManage}
            currentUserId={scope.userId}
            members={workspace.members}
            organizationId={scope.organizationId}
            workspaceName={workspace.name}
          />
          {canManage ? (
            <>
              <InviteForm organizationId={scope.organizationId} />
              <PendingInvites invitations={workspace.invitations} />
            </>
          ) : null}
        </div>
      ) : (
        <Alert variant="destructive">
          Couldn&apos;t load workspace members. Refresh to try again.
        </Alert>
      )}
    </div>
  );
}
