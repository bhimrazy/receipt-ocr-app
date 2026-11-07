import { listUsers, policyFor, type UserSort } from "@receipt-ocr/core";
import type { Metadata } from "next";
import { AdminPageHeader } from "@/components/admin/page-header";
import { ListToolbar } from "@/components/admin/list-toolbar";
import { Pager } from "@/components/admin/pager";
import { getPlanTable } from "@/lib/plan-limits";
import { runtime } from "@/lib/runtime";
import { requireAdmin } from "@/lib/session";
import { one, PAGE_SIZE, pageOf, pick, type SearchParams } from "../params";
import { UsersTable } from "./users-table";
import { logPageRender } from "@/lib/page-event";

export const metadata: Metadata = { title: "Users" };

const SORTS = ["newest", "oldest", "name", "usage"] as const;
const SORT_MAP: Record<(typeof SORTS)[number], { sort: UserSort; dir: "asc" | "desc" }> = {
  newest: { sort: "joined", dir: "desc" },
  oldest: { sort: "joined", dir: "asc" },
  name: { sort: "name", dir: "asc" },
  usage: { sort: "usage", dir: "desc" },
};

export default async function AdminUsersPage({ searchParams }: { searchParams: SearchParams }) {
  logPageRender("/admin/users");
  const session = await requireAdmin();
  const params = await searchParams;
  const filters = {
    q: one(params.q),
    role: pick(params.role, ["admin", "user"] as const),
    plan: pick(params.plan, ["free", "pro"] as const),
    status: pick(params.status, ["active", "banned", "unverified"] as const),
  };
  const sortKey = pick(params.sort, SORTS) ?? "newest";
  const page = pageOf(params.page);
  const [plans, result] = await Promise.all([
    getPlanTable(),
    runtime.runPromise(
      listUsers({ ...filters, ...SORT_MAP[sortKey] }, { page, pageSize: PAGE_SIZE }),
    ),
  ]);
  const filtered = Object.values(filters).some(Boolean);

  return (
    <>
      <AdminPageHeader
        description="Search by name or email, or filter by role, plan and status. Open a user to change their plan or role, ban them, or sign in as them."
        title="Users"
      />
      <ListToolbar
        searchLabel="Search users by name or email"
        searchPlaceholder="Name or email"
        selects={[
          {
            name: "status",
            label: "Status",
            options: [
              { value: "any", label: "Any status" },
              { value: "active", label: "Active" },
              { value: "banned", label: "Banned" },
              { value: "unverified", label: "Email not verified" },
            ],
          },
          {
            name: "plan",
            label: "Plan",
            options: [
              { value: "any", label: "Any plan" },
              { value: "free", label: "Free" },
              { value: "pro", label: "Pro" },
            ],
          },
          {
            name: "role",
            label: "Role",
            options: [
              { value: "any", label: "Any role" },
              { value: "admin", label: "Admin" },
              { value: "user", label: "User" },
            ],
          },
          {
            name: "sort",
            label: "Sort",
            options: [
              { value: "newest", label: "Newest first" },
              { value: "oldest", label: "Oldest first" },
              { value: "name", label: "Name A–Z" },
              { value: "usage", label: "Most used today" },
            ],
          },
        ]}
      />
      <UsersTable
        currentUserId={session.user.id}
        filtered={filtered}
        users={result.rows.map((row) => ({
          ...row,
          limit: policyFor(plans, row.plan).receiptsPerDay,
        }))}
      />
      <Pager
        noun="users"
        page={page}
        pageSize={PAGE_SIZE}
        params={{ ...filters, sort: sortKey === "newest" ? undefined : sortKey }}
        total={result.total}
      />
    </>
  );
}
