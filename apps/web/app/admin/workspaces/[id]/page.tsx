import { listAudit, workspaceDetail } from "@receipt-ocr/core";
import { Effect } from "effect";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AuditList } from "@/components/admin/audit-list";
import { AdminPageHeader, AdminSection } from "@/components/admin/page-header";
import { Stat } from "@/components/admin/stat";
import { formatDate } from "@/lib/format";
import { runtime } from "@/lib/runtime";
import { requireAdmin } from "@/lib/session";
import { DeleteWorkspace, InvitationsList, MembersTable } from "./workspace-actions";
import { logPageRender } from "@/lib/page-event";

export const metadata: Metadata = { title: "Workspace" };

export default async function AdminWorkspacePage({ params }: { params: Promise<{ id: string }> }) {
  logPageRender("/admin/workspaces/[id]");
  await requireAdmin();
  const { id } = await params;
  const [workspace, audit] = await runtime.runPromise(
    Effect.all([
      workspaceDetail(id),
      listAudit({ targetType: "workspace", targetId: id }, { page: 1, pageSize: 20 }),
    ]),
  );
  if (!workspace) notFound();
  const owner = workspace.members.find((m) => m.role === "owner");
  const { receipts } = workspace;

  return (
    <>
      <AdminPageHeader
        back={{ href: "/admin/workspaces", label: "Workspaces" }}
        description={
          <>
            {owner ? `Owned by ${owner.email}` : "No owner"} · Created{" "}
            {formatDate(workspace.createdAt)}
          </>
        }
        title={workspace.name}
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label="Members"
          value={workspace.members.length}
          note={`${workspace.invitations.length} invited`}
        />
        <Stat
          label="Receipts today"
          value={receipts.today}
          note={`${receipts.week} in the last 7 days`}
        />
        <Stat
          label="Receipts"
          note={
            receipts.formerMembers > 0
              ? `${receipts.formerMembers} from former members`
              : "All time"
          }
          value={receipts.total}
        />
        <Stat
          label="Failed"
          note={receipts.failed > 0 ? "Could not be read" : "None"}
          tone={receipts.failed > 0 ? "warning" : "default"}
          value={receipts.failed}
        />
      </div>

      <div className="mt-8 grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex min-w-0 flex-col gap-8">
          <AdminSection
            description="Changes apply on the member's next request."
            id="members"
            title="Members"
          >
            <MembersTable
              members={workspace.members.map((m) => ({ ...m, joinedAt: m.joinedAt.toISOString() }))}
              organizationId={workspace.id}
              workspaceName={workspace.name}
            />
          </AdminSection>
          <AdminSection id="activity" title="Admin activity on this workspace">
            <AuditList
              empty="No admin has changed this workspace yet."
              entries={audit.rows}
              showTarget={false}
            />
          </AdminSection>
        </div>
        <div className="flex flex-col gap-8">
          <AdminSection id="invitations" title="Pending invitations">
            <InvitationsList
              invitations={workspace.invitations.map((inv) => ({
                ...inv,
                expiresAt: inv.expiresAt.toISOString(),
              }))}
              organizationId={workspace.id}
            />
          </AdminSection>
          <section
            aria-labelledby="delete-workspace"
            className="rounded-lg border border-destructive/30 bg-card p-4"
          >
            <h2 className="text-base font-semibold" id="delete-workspace">
              Delete this workspace
            </h2>
            <p className="mt-1 mb-4 text-sm text-muted-foreground">
              Removes every receipt and image in it. Member accounts stay. You type the workspace
              name to confirm.
            </p>
            <DeleteWorkspace
              members={workspace.members.length}
              name={workspace.name}
              organizationId={workspace.id}
              receipts={receipts.total}
            />
          </section>
          <p className="font-mono text-xs break-all text-muted-foreground">
            Workspace ID {workspace.id}
          </p>
        </div>
      </div>
    </>
  );
}
