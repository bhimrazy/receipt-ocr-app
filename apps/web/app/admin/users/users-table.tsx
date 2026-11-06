import type { AdminUserRow } from "@receipt-ocr/core";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@receipt-ocr/ui/components/table";
import Link from "next/link";
import { Meter } from "@/components/admin/meter";
import { Initial, UserBadges } from "@/components/admin/user-badges";
import { formatDate } from "@/lib/format";
import { planLabel } from "@/lib/plans";

type Row = AdminUserRow & { limit: number };

const linkClass =
  "rounded-md outline-none after:absolute after:inset-0 focus-visible:ring-2 focus-visible:ring-ring";

function Empty({ filtered }: { filtered: boolean }) {
  return (
    <p className="px-4 py-12 text-center text-sm text-muted-foreground">
      {filtered ? "No users match this search or these filters." : "No users yet."}
    </p>
  );
}

/** Each row links to the user's page, where every action lives. */
export function UsersTable({
  users,
  currentUserId,
  filtered,
}: {
  users: Row[];
  currentUserId: string;
  filtered: boolean;
}) {
  const you = (id: string) =>
    id === currentUserId ? <span className="text-muted-foreground"> (you)</span> : null;

  return (
    <>
      <ul className="divide-y divide-border rounded-lg border border-border bg-card md:hidden">
        {users.length === 0 ? (
          <li>
            <Empty filtered={filtered} />
          </li>
        ) : (
          users.map((user) => (
            <li className="relative px-4 py-3.5 hover:bg-wash-subtle" key={user.id}>
              <div className="flex items-start gap-3">
                <Initial email={user.email} name={user.name} />
                <div className="min-w-0 flex-1">
                  <Link className={linkClass} href={`/admin/users/${user.id}`}>
                    <span className="block truncate text-sm font-medium">
                      {user.name || user.email}
                      {you(user.id)}
                    </span>
                  </Link>
                  <span className="block truncate text-xs text-muted-foreground">{user.email}</span>
                  <div className="mt-2">
                    <UserBadges {...user} />
                  </div>
                  <div className="mt-2.5 flex items-center gap-3 text-xs text-muted-foreground">
                    <span className="shrink-0">{planLabel(user.plan)}</span>
                    <Meter
                      className="flex-1"
                      label={`Receipts used today by ${user.email}`}
                      limit={user.limit}
                      used={user.usedToday}
                    />
                  </div>
                </div>
              </div>
            </li>
          ))
        )}
      </ul>

      <div className="hidden overflow-hidden rounded-lg border border-border bg-card md:block">
        <Table>
          <caption className="sr-only">Users</caption>
          <TableHeader>
            <TableRow>
              <TableHead>User</TableHead>
              <TableHead>Plan</TableHead>
              <TableHead className="w-48">Used today</TableHead>
              <TableHead className="text-right">Workspaces</TableHead>
              <TableHead className="text-right">Joined</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5}>
                  <Empty filtered={filtered} />
                </TableCell>
              </TableRow>
            ) : (
              users.map((user) => (
                <TableRow className="relative hover:bg-wash-subtle" key={user.id}>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <Initial email={user.email} name={user.name} />
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <Link
                            className={`${linkClass} font-medium`}
                            href={`/admin/users/${user.id}`}
                          >
                            {user.name || user.email}
                            {you(user.id)}
                          </Link>
                          <UserBadges {...user} />
                        </div>
                        <div className="truncate text-xs text-muted-foreground">{user.email}</div>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="text-sm">
                    {planLabel(user.plan).replace(" plan", "")}
                  </TableCell>
                  <TableCell>
                    <Meter
                      label={`Receipts used today by ${user.email}`}
                      limit={user.limit}
                      used={user.usedToday}
                    />
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm tabular-nums">
                    {user.workspaces}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs text-muted-foreground tabular-nums">
                    {formatDate(user.createdAt)}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </>
  );
}
