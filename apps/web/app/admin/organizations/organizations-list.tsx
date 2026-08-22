"use client";

import { Badge } from "@receipt-ocr/ui/components/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@receipt-ocr/ui/components/table";
import { ChevronDown, ChevronRight } from "lucide-react";
import Link from "next/link";
import { Fragment, useState } from "react";

export interface AdminOrganization {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
  memberCount: number;
  owner: { name: string; email: string } | null;
  members: { userId: string; name: string; email: string; role: string }[];
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function OrganizationsList({
  organizations,
}: {
  organizations: AdminOrganization[];
}) {
  const [expanded, setExpanded] = useState<string | null>(null);

  return (
    <div className="rounded-lg border border-border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-8" />
            <TableHead>Organization</TableHead>
            <TableHead>Owner</TableHead>
            <TableHead>Members</TableHead>
            <TableHead>Created</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {organizations.length === 0 ? (
            <TableRow>
              <TableCell className="py-10 text-center text-sm text-muted-foreground" colSpan={5}>
                No organizations found.
              </TableCell>
            </TableRow>
          ) : (
            organizations.map((org) => {
              const isOpen = expanded === org.id;
              return (
                <Fragment key={org.id}>
                  <TableRow
                    className="cursor-pointer"
                    onClick={() => setExpanded(isOpen ? null : org.id)}
                  >
                    <TableCell>
                      {isOpen ? (
                        <ChevronDown className="size-4 text-muted-foreground" />
                      ) : (
                        <ChevronRight className="size-4 text-muted-foreground" />
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="font-medium">{org.name}</div>
                      <div className="font-mono text-xs text-muted-foreground">{org.slug}</div>
                    </TableCell>
                    <TableCell className="text-sm">
                      {org.owner ? (
                        <div>
                          <div>{org.owner.name || "—"}</div>
                          <div className="text-xs text-muted-foreground">{org.owner.email}</div>
                        </div>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">{org.memberCount}</Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {formatDate(org.createdAt)}
                    </TableCell>
                  </TableRow>
                  {isOpen ? (
                    <TableRow>
                      <TableCell className="bg-background/40" colSpan={5}>
                        <div className="space-y-1.5 py-1">
                          {org.members.length === 0 ? (
                            <p className="text-sm text-muted-foreground">No members.</p>
                          ) : (
                            org.members.map((entry) => (
                              <div
                                className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card px-3 py-2"
                                key={entry.userId}
                              >
                                <Link
                                  className="min-w-0 hover:text-primary"
                                  href={`/admin/users/${entry.userId}`}
                                >
                                  <div className="truncate text-sm font-medium">
                                    {entry.name || "—"}
                                  </div>
                                  <div className="truncate text-xs text-muted-foreground">
                                    {entry.email}
                                  </div>
                                </Link>
                                <Badge variant={entry.role === "owner" ? "default" : "secondary"}>
                                  {entry.role}
                                </Badge>
                              </div>
                            ))
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ) : null}
                </Fragment>
              );
            })
          )}
        </TableBody>
      </Table>
    </div>
  );
}
