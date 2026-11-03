import { auth } from "@/lib/auth";
import { requireAdmin } from "@/lib/session";
import { headers } from "next/headers";
import { UsersTable, type AdminUser } from "./users-table";

const PAGE_SIZE = 20;

function toIso(value: unknown): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value as string);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  await requireAdmin();
  const params = await searchParams;
  const search = (params.q ?? "").trim();
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);
  const offset = (page - 1) * PAGE_SIZE;

  const result = await auth.api.listUsers({
    query: {
      limit: PAGE_SIZE,
      offset,
      sortBy: "createdAt",
      sortDirection: "desc",
      ...(search ? { searchField: "email", searchOperator: "contains", searchValue: search } : {}),
    },
    headers: await headers(),
  });

  const rawUsers = "users" in result ? result.users : [];
  const total =
    "total" in result && typeof result.total === "number" ? result.total : rawUsers.length;

  const users: AdminUser[] = rawUsers.map((user) => ({
    id: user.id,
    name: user.name,
    email: user.email,
    role: (user.role as string | null) ?? "user",
    banned: Boolean(user.banned),
    banReason: (user.banReason as string | null) ?? null,
    banExpires: toIso(user.banExpires),
    emailVerified: Boolean(user.emailVerified),
    createdAt: toIso(user.createdAt) ?? new Date().toISOString(),
  }));

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-8">
        <h1 className="text-3xl font-semibold tracking-tight">Users</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {total} {total === 1 ? "user" : "users"} · manage roles, bans, sessions, and
          impersonation.
        </p>
      </div>
      <UsersTable page={page} pageSize={PAGE_SIZE} search={search} total={total} users={users} />
    </div>
  );
}
