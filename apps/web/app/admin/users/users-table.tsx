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

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function UsersTable({
  users,
  total,
  page,
  pageSize,
  search,
}: {
  users: AdminUser[];
  total: number;
  page: number;
  pageSize: number;
  search: string;
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
        onSubmit={(event) => {
          event.preventDefault();
          pushParams({ q: query.trim(), page: 1 });
        }}
      >
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search by email..."
            value={query}
          />
        </div>
        <Button size="sm" type="submit" variant="outline">
          Search
        </Button>
      </form>

      <div className="rounded-lg border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>User</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Joined</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.length === 0 ? (
              <TableRow>
                <TableCell className="py-10 text-center text-sm text-muted-foreground" colSpan={5}>
                  No users found.
                </TableCell>
              </TableRow>
            ) : (
              users.map((user) => (
                <TableRow key={user.id}>
                  <TableCell>
                    <Link className="group block" href={`/admin/users/${user.id}`}>
                      <div className="font-medium group-hover:text-primary">{user.name || "—"}</div>
                      <div className="text-xs text-muted-foreground">{user.email}</div>
                    </Link>
                  </TableCell>
                  <TableCell>
                    <Badge variant={user.role === "admin" ? "default" : "secondary"}>
                      {user.role}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {user.banned ? (
                      <Badge variant="destructive">Banned</Badge>
                    ) : user.emailVerified ? (
                      <Badge variant="secondary">Active</Badge>
                    ) : (
                      <Badge variant="secondary">Unverified</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {formatDate(user.createdAt)}
                  </TableCell>
                  <TableCell className="text-right">
                    <RowActions user={user} />
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <div className="mt-4 flex items-center justify-between text-sm text-muted-foreground">
        <span>
          Page {page} of {totalPages}
        </span>
        <div className="flex gap-2">
          <Button
            disabled={page <= 1}
            onClick={() => pushParams({ page: page - 1 })}
            size="sm"
            variant="outline"
          >
            <ChevronLeft className="size-4" />
            Prev
          </Button>
          <Button
            disabled={page >= totalPages}
            onClick={() => pushParams({ page: page + 1 })}
            size="sm"
            variant="outline"
          >
            Next
            <ChevronRight className="size-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
