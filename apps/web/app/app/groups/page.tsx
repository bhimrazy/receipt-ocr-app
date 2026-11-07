import { GroupsManager } from "@/components/groups/groups-manager";
import {
  PageHeader,
  PageHeaderContent,
  PageHeaderDescription,
  PageHeaderTitle,
} from "@/components/page-header";
import { getWorkspaceGroups } from "@/lib/groups";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Groups" };

export default async function GroupsPage() {
  const groups = await getWorkspaceGroups();
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader>
        <PageHeaderContent>
          <PageHeaderTitle>Groups</PageHeaderTitle>
          <PageHeaderDescription>
            Collect receipts for a trip, a client or a year. A receipt can be in several groups, and
            deleting a group keeps its receipts.
          </PageHeaderDescription>
        </PageHeaderContent>
      </PageHeader>
      <GroupsManager groups={groups} />
    </div>
  );
}
