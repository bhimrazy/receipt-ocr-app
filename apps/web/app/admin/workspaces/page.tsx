import { listWorkspaces, type WorkspaceSort } from "@receipt-ocr/core";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@receipt-ocr/ui/components/table";
import type { Metadata } from "next";
import Link from "next/link";
import { ListToolbar } from "@/components/admin/list-toolbar";
import { AdminPageHeader } from "@/components/admin/page-header";
import { Pager } from "@/components/admin/pager";
import { formatDate } from "@/lib/format";
import { runtime } from "@/lib/runtime";
import { requireAdmin } from "@/lib/session";
import { one, PAGE_SIZE, pageOf, pick, type SearchParams } from "../params";

export const metadata: Metadata = { title: "Workspaces" };

const SORTS = ["newest", "oldest", "name", "receipts"] as const;
const SORT_MAP: Record<(typeof SORTS)[number], { sort: WorkspaceSort; dir: "asc" | "desc" }> = {
  newest: { sort: "created", dir: "desc" },
  oldest: { sort: "created", dir: "asc" },
  name: { sort: "name", dir: "asc" },
  receipts: { sort: "receipts", dir: "desc" },
};

const linkClass =
  "rounded-md font-medium outline-none after:absolute after:inset-0 focus-visible:ring-2 focus-visible:ring-ring";

export default async function AdminWorkspacesPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  await requireAdmin();
  const params = await searchParams;
  const q = one(params.q);
  const sortKey = pick(params.sort, SORTS) ?? "newest";
  const page = pageOf(params.page);
  const { rows, total } = await runtime.runPromise(
    listWorkspaces({ q, ...SORT_MAP[sortKey] }, { page, pageSize: PAGE_SIZE }),
  );
  const empty = (
    <p className="px-4 py-12 text-center text-sm text-muted-foreground">
      {q ? "No workspace matches that search." : "No workspaces yet."}
    </p>
  );
  const owner = (row: (typeof rows)[number]) =>
    row.ownerEmail ? (
      <span className="block truncate text-xs text-muted-foreground">
        {row.ownerName ? `${row.ownerName} · ` : ""}
        {row.ownerEmail}
      </span>
    ) : (
      <span className="block text-xs text-warning">No owner</span>
    );

  return (
    <>
      <AdminPageHeader
        description="Every workspace, with its owner, members and receipts. Open one to change member roles, cancel invitations or delete it."
        title="Workspaces"
      />
      <ListToolbar
        searchLabel="Search workspaces by name or owner email"
        searchPlaceholder="Workspace name or owner email"
        selects={[
          {
            name: "sort",
            label: "Sort",
            options: [
              { value: "newest", label: "Newest first" },
              { value: "oldest", label: "Oldest first" },
              { value: "name", label: "Name A–Z" },
              { value: "receipts", label: "Most receipts" },
            ],
          },
        ]}
      />

      <ul className="divide-y divide-border rounded-lg border border-border bg-card md:hidden">
        {rows.length === 0 ? (
          <li>{empty}</li>
        ) : (
          rows.map((row) => (
            <li className="relative px-4 py-3.5 hover:bg-wash-subtle" key={row.id}>
              <Link
                className={`${linkClass} block truncate text-sm`}
                href={`/admin/workspaces/${row.id}`}
              >
                {row.name}
              </Link>
              {owner(row)}
              <p className="mt-2 font-mono text-xs text-muted-foreground tabular-nums">
                {row.members} {row.members === 1 ? "member" : "members"} · {row.receipts} receipts ·{" "}
                {row.receiptsToday} today
              </p>
            </li>
          ))
        )}
      </ul>

      <div className="hidden overflow-hidden rounded-lg border border-border bg-card md:block">
        <Table>
          <caption className="sr-only">Workspaces</caption>
          <TableHeader>
            <TableRow>
              <TableHead>Workspace</TableHead>
              <TableHead className="text-right">Members</TableHead>
              <TableHead className="text-right">Receipts today</TableHead>
              <TableHead className="text-right">Receipts</TableHead>
              <TableHead className="text-right">Created</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5}>{empty}</TableCell>
              </TableRow>
            ) : (
              rows.map((row) => (
                <TableRow className="relative hover:bg-wash-subtle" key={row.id}>
                  <TableCell className="max-w-0 w-1/2">
                    <Link
                      className={`${linkClass} block truncate`}
                      href={`/admin/workspaces/${row.id}`}
                    >
                      {row.name}
                    </Link>
                    {owner(row)}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">{row.members}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {row.receiptsToday}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {row.receipts}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs text-muted-foreground tabular-nums">
                    {formatDate(row.createdAt)}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
      <Pager
        noun="workspaces"
        page={page}
        pageSize={PAGE_SIZE}
        params={{ q, sort: sortKey === "newest" ? undefined : sortKey }}
        total={total}
      />
    </>
  );
}
