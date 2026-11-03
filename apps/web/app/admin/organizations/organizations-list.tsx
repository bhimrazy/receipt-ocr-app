"use client";

import { Badge } from "@receipt-ocr/ui/components/badge";
import { Button } from "@receipt-ocr/ui/components/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@receipt-ocr/ui/components/table";
import { ChevronDown, ChevronRight } from "lucide-react";
import Link from "next/link";
import { Fragment, useState } from "react";
import { formatDate } from "@/lib/format";

export interface AdminOrganization {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
  memberCount: number;
  owner: { name: string; email: string } | null;
  members: { userId: string; name: string; email: string; role: string }[];
}

function roleLabel(role: string) {
  return `${role.charAt(0).toUpperCase()}${role.slice(1)}`;
}

function memberCount(n: number) {
  return `${n} ${n === 1 ? "member" : "members"}`;
}

function ToggleButton({ org, open, onToggle }: { org: AdminOrganization; open: boolean; onToggle: () => void }) {
  const Icon = open ? ChevronDown : ChevronRight;
  return (
    <Button
      aria-controls={`members-${org.id}`}
      aria-expanded={open}
      aria-label={`${open ? "Hide" : "Show"} members of ${org.name}`}
      onClick={onToggle}
      size="icon-sm"
      variant="ghost"
    >
      <Icon aria-hidden="true" />
    </Button>
  );
}

function MemberList({ org }: { org: AdminOrganization }) {
  if (org.members.length === 0) return <p className="text-sm text-muted-foreground">No members.</p>;
  return (
    <ul className="space-y-1.5" id={`members-${org.id}`}>
      {org.members.map((entry) => (
        <li
          className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card px-3 py-2"
          key={entry.userId}
        >
          <Link
            className="min-w-0 rounded-md outline-none hover:text-primary focus-visible:ring-2 focus-visible:ring-ring"
            href={`/admin/users/${entry.userId}`}
          >
            <span className="block truncate text-sm font-medium">{entry.name || entry.email}</span>
            <span className="block truncate text-xs text-muted-foreground">{entry.email}</span>
          </Link>
          <Badge variant={entry.role === "owner" ? "default" : "secondary"}>{roleLabel(entry.role)}</Badge>
        </li>
      ))}
    </ul>
  );
}

export function OrganizationsList({ organizations }: { organizations: AdminOrganization[] }) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const toggle = (id: string) => setExpanded((current) => (current === id ? null : id));

  if (organizations.length === 0) {
    return (
      <p className="rounded-lg border border-border px-4 py-10 text-center text-sm text-muted-foreground">
        No workspaces yet.
      </p>
    );
  }

  return (
    <>
      <ul className="divide-y divide-border rounded-lg border border-border md:hidden">
        {organizations.map((org) => {
          const isOpen = expanded === org.id;
          return (
            <li className="px-4 py-3" key={org.id}>
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{org.name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {org.owner ? `Owner: ${org.owner.email}` : "No owner"}
                  </p>
                  <p className="mt-1.5 text-xs text-muted-foreground">
                    {memberCount(org.memberCount)} · Created {formatDate(org.createdAt)}
                  </p>
                </div>
                <ToggleButton onToggle={() => toggle(org.id)} open={isOpen} org={org} />
              </div>
              {isOpen ? (
                <div className="mt-3">
                  <MemberList org={org} />
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>

      <div className="hidden rounded-lg border border-border md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-12">
                <span className="sr-only">Members</span>
              </TableHead>
              <TableHead>Workspace</TableHead>
              <TableHead>Owner</TableHead>
              <TableHead className="text-right">Members</TableHead>
              <TableHead>Created</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {organizations.map((org) => {
              const isOpen = expanded === org.id;
              return (
                <Fragment key={org.id}>
                  <TableRow>
                    <TableCell>
                      <ToggleButton onToggle={() => toggle(org.id)} open={isOpen} org={org} />
                    </TableCell>
                    <TableCell>
                      <div className="font-medium">{org.name}</div>
                      <div className="font-mono text-xs text-muted-foreground">{org.slug}</div>
                    </TableCell>
                    <TableCell className="text-sm">
                      {org.owner ? (
                        <div>
                          <div>{org.owner.name || org.owner.email}</div>
                          <div className="text-xs text-muted-foreground">{org.owner.email}</div>
                        </div>
                      ) : (
                        <span className="text-muted-foreground">No owner</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">{org.memberCount}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{formatDate(org.createdAt)}</TableCell>
                  </TableRow>
                  {isOpen ? (
                    <TableRow>
                      <TableCell className="bg-background/40" colSpan={5}>
                        <div className="py-1">
                          <MemberList org={org} />
                        </div>
                      </TableCell>
                    </TableRow>
                  ) : null}
                </Fragment>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </>
  );
}
