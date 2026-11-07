import { listAudit } from "@receipt-ocr/core";
import type { Metadata } from "next";
import { AuditList } from "@/components/admin/audit-list";
import { ListToolbar } from "@/components/admin/list-toolbar";
import { AdminPageHeader } from "@/components/admin/page-header";
import { Pager } from "@/components/admin/pager";
import { runtime } from "@/lib/runtime";
import { requireAdmin } from "@/lib/session";
import { one, PAGE_SIZE, pageOf, pick, type SearchParams } from "../params";
import { logPageRender } from "@/lib/page-event";

export const metadata: Metadata = { title: "Audit log" };

export default async function AdminAuditPage({ searchParams }: { searchParams: SearchParams }) {
  logPageRender("/admin/audit");
  await requireAdmin();
  const params = await searchParams;
  const q = one(params.q);
  const type = pick(params.type, ["user", "workspace", "settings"] as const);
  const page = pageOf(params.page);
  const { rows, total } = await runtime.runPromise(
    listAudit({ q, targetType: type }, { page, pageSize: PAGE_SIZE }),
  );

  return (
    <>
      <AdminPageHeader
        description="Every change made in this panel: who made it, to what, when, and the reason they gave. Entries can't be edited or deleted here."
        title="Audit log"
      />
      <ListToolbar
        searchLabel="Search the audit log"
        searchPlaceholder="Email, workspace or reason"
        selects={[
          {
            name: "type",
            label: "Changes to",
            options: [
              { value: "all", label: "Everything" },
              { value: "user", label: "Users" },
              { value: "workspace", label: "Workspaces" },
              { value: "settings", label: "Settings" },
            ],
          },
        ]}
      />
      <AuditList
        empty={q || type ? "No entries match this search." : "No admin actions yet."}
        entries={rows}
      />
      <Pager noun="entries" page={page} pageSize={PAGE_SIZE} params={{ q, type }} total={total} />
    </>
  );
}
