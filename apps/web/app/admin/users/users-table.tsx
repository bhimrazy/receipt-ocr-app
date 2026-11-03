"use client";

import { Badge } from "@receipt-ocr/ui/components/badge";
import { Button } from "@receipt-ocr/ui/components/button";
import { Input } from "@receipt-ocr/ui/components/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@receipt-ocr/ui/components/table";
import { ChevronLeft, ChevronRight, Search } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { formatDate } from "@/lib/format";
import { RowActions } from "./row-actions";

export interface AdminUser {
  id: string;
  name: string;
  email: string;
  role: string;
  banned: boolean;
  banReason: string | null;
  banExpires: string | null;
  emailVerified: boolean;
  createdAt: string;
}

function RoleBadge({ role }: { role: string }) {
  return <Badge variant={role === "admin" ? "default" : "secondary"}>{role === "admin" ? "Admin" : "User"}</Badge>;
}

function StatusBadge({ user }: { user: AdminUser }) {
  if (user.banned) return <Badge variant="destructive">Banned</Badge>;
  return <Badge variant="secondary">{user.emailVerified ? "Active" : "Unverified"}</Badge>;
}

export function UsersTable({
  users,
  total,
  page,
  pageSize,
  search,
  currentUserId,
}: {
  users: AdminUser[];
  total: number;
  page: number;
  pageSize: number;
  search: string;
  currentUserId: string | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [query, setQuery] = useState(search);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  function pushParams(next: { q?: string; page?: number }) {
    const params = new URLSearchParams(searchParams.toString());
    if (next.q !== undefined) {
      if (next.q) params.set("q", next.q);
      else params.delete("q");
    }
    if (next.page !== undefined) {
      if (next.page > 1) params.set("page", String(next.page));
      else params.delete("page");
    }
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <div>
      <form
        className="mb-5 flex max-w-sm items-center gap-2"
        role="search"
        onSubmit={(event) => {
          event.preventDefault();
          pushParams({ q: query.trim(), page: 1 });
        }}
      >
        <div className="relative flex-1">
          <Search aria-hidden="true" className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            aria-label="Search users by email"
            className="pl-9"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search by email"
            type="search"
            value={query}
          />
        </div>
        <Button size="sm" type="submit" variant="outline">
          Search
        </Button>
      </form>

      <ul className="divide-y divide-border rounded-lg border border-border md:hidden">
        {users.length === 0 ? (
          <li className="px-4 py-10 text-center text-sm text-muted-foreground">No users match that search.</li>
        ) : (
          users.map((user) => (
            <li className="flex items-start gap-2 px-4 py-3" key={user.id}>
              <Link
                className="min-w-0 flex-1 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
                href={`/admin/users/${user.id}`}
              >
                <span className="block truncate text-sm font-medium">{user.name || user.email}</span>
                <span className="block truncate text-xs text-muted-foreground">{user.email}</span>
                <span className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <RoleBadge role={user.role} />
                  <StatusBadge user={user} />
                  <span>Joined {formatDate(user.createdAt)}</span>
                </span>
              </Link>
              <RowActions currentUserId={currentUserId} user={user} />
            </li>
          ))
        )}
      </ul>

      <div className="hidden rounded-lg border border-border md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>User</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Joined</TableHead>
              <TableHead className="text-right">
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.length === 0 ? (
              <TableRow>
                <TableCell className="py-10 text-center text-sm text-muted-foreground" colSpan={5}>
                  No users match that search.
                </TableCell>
              </TableRow>
            ) : (
              users.map((user) => (
                <TableRow key={user.id}>
                  <TableCell>
                    <Link
                      className="group block rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      href={`/admin/users/${user.id}`}
                    >
                      <div className="font-medium group-hover:text-primary">{user.name || user.email}</div>
                      <div className="text-xs text-muted-foreground">{user.email}</div>
                    </Link>
                  </TableCell>
                  <TableCell>
                    <RoleBadge role={user.role} />
                  </TableCell>
                  <TableCell>
                    <StatusBadge user={user} />
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {formatDate(user.createdAt)}
                  </TableCell>
                  <TableCell className="text-right">
                    <RowActions currentUserId={currentUserId} user={user} />
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <div className="mt-4 flex items-center justify-between text-sm text-muted-foreground">
        <span className="font-mono tabular-nums">
          Page {page} of {totalPages}
        </span>
        <div className="flex gap-2">
          <Button
            disabled={page <= 1}
            onClick={() => pushParams({ page: page - 1 })}
            size="sm"
            variant="outline"
          >
            <ChevronLeft aria-hidden="true" />
            Previous
          </Button>
          <Button
            disabled={page >= totalPages}
            onClick={() => pushParams({ page: page + 1 })}
            size="sm"
            variant="outline"
          >
            Next
            <ChevronRight aria-hidden="true" />
          </Button>
        </div>
      </div>
    </div>
  );
}
