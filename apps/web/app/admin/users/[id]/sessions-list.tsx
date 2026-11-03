"use client";

import { Badge } from "@receipt-ocr/ui/components/badge";
import { Button } from "@receipt-ocr/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@receipt-ocr/ui/components/card";
import { ConfirmDialog } from "@receipt-ocr/ui/components/confirm-dialog";
import { toast } from "@receipt-ocr/ui/components/toast";
import { Monitor, ShieldX } from "lucide-react";
import { useState } from "react";
import { formatDateTime } from "@/lib/format";
import { revokeUserSessionAction, revokeUserSessionsAction } from "../../actions";

export interface AdminSession {
  id: string;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
  expiresAt: string;
  impersonatedBy: string | null;
}

/** Drops leading zeros and collapses the longest zero run, so 0000:…:0001 reads "::1". */
function compressIp(ip: string | null): string {
  if (!ip) return "Unknown IP";
  if (!ip.includes(":") || ip.includes("::")) return ip;
  const parts = ip.split(":").map((part) => part.replace(/^0+(?=.)/, ""));
  let best = { start: -1, length: 0 };
  for (let i = 0; i < parts.length;) {
    if (parts[i] !== "0") {
      i++;
      continue;
    }
    let j = i;
    while (j < parts.length && parts[j] === "0") j++;
    if (j - i > best.length) best = { start: i, length: j - i };
    i = j;
  }
  if (best.length < 2) return parts.join(":");
  const head = parts.slice(0, best.start).join(":");
  const tail = parts.slice(best.start + best.length).join(":");
  return `${head}::${tail}`;
}

/** "Chrome 156 · macOS" from a user-agent string; order matters (Edge and Opera also say Chrome). */
function describeAgent(ua: string | null): string {
  if (!ua) return "Unknown device";
  const browsers: [string, RegExp][] = [
    ["Edge", /Edg(?:e|A|iOS)?\/(\d+)/],
    ["Opera", /OPR\/(\d+)/],
    ["Firefox", /(?:Firefox|FxiOS)\/(\d+)/],
    ["Chrome", /(?:Chrome|CriOS)\/(\d+)/],
    ["Safari", /Version\/(\d+).*Safari/],
  ];
  const systems: [string, RegExp][] = [
    ["iOS", /iPhone|iPad|iPod/],
    ["Android", /Android/],
    ["Windows", /Windows/],
    ["macOS", /Mac OS X|Macintosh/],
    ["ChromeOS", /CrOS/],
    ["Linux", /Linux/],
  ];
  const browser = browsers.find(([, re]) => re.test(ua));
  const version = browser ? ua.match(browser[1])?.[1] : undefined;
  const system = systems.find(([, re]) => re.test(ua))?.[0];
  const name = browser ? `${browser[0]}${version ? ` ${version}` : ""}` : null;
  return [name, system].filter(Boolean).join(" · ") || "Unknown device";
}

type Pending = { kind: "all" } | { kind: "one"; session: AdminSession };

export function SessionsList({
  sessions,
  userId,
  currentSessionId,
}: {
  sessions: AdminSession[];
  userId: string;
  currentSessionId: string | null;
}) {
  const [pending, setPending] = useState<Pending | null>(null);
  const [open, setOpen] = useState(false);

  function ask(next: Pending) {
    setPending(next);
    setOpen(true);
  }

  async function confirm(): Promise<string | void> {
    if (!pending) return;
    const result =
      pending.kind === "all"
        ? await revokeUserSessionsAction(userId)
        : await revokeUserSessionAction(pending.session.id, userId);
    if (!result.ok) return result.error ?? "Couldn't revoke. Try again.";
    toast.add({
      title: pending.kind === "all" ? "All sessions revoked." : "Session revoked.",
      type: "success",
    });
  }

  const includesCurrent =
    pending?.kind === "all"
      ? sessions.some((s) => s.id === currentSessionId)
      : pending?.session.id === currentSessionId;

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
        <CardTitle>Active sessions ({sessions.length})</CardTitle>
        {sessions.length > 0 ? (
          <Button onClick={() => ask({ kind: "all" })} size="sm" variant="outline">
            <ShieldX aria-hidden="true" />
            Revoke all
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-2">
        {sessions.length === 0 ? (
          <p className="text-sm text-muted-foreground">No active sessions.</p>
        ) : (
          sessions.map((session) => {
            const isCurrent = session.id === currentSessionId;
            return (
              <div
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-background/40 px-3 py-2.5"
                key={session.id}
              >
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <Monitor aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <span className="truncate" title={session.userAgent ?? undefined}>
                        {describeAgent(session.userAgent)}
                      </span>
                      {isCurrent ? <Badge>This session</Badge> : null}
                      {session.impersonatedBy ? (
                        <Badge variant="warning">Impersonated</Badge>
                      ) : null}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      <span className="font-mono">{compressIp(session.ipAddress)}</span> · Started{" "}
                      <span title={`Expires ${formatDateTime(session.expiresAt)}`}>
                        {formatDateTime(session.createdAt)}
                      </span>
                    </div>
                  </div>
                </div>
                <Button
                  className="shrink-0"
                  onClick={() => ask({ kind: "one", session })}
                  size="sm"
                  variant="ghost"
                >
                  Revoke
                </Button>
              </div>
            );
          })
        )}
      </CardContent>
      <ConfirmDialog
        confirmLabel={pending?.kind === "all" ? "Revoke all sessions" : "Revoke session"}
        description={
          includesCurrent
            ? "This includes the session you're using now, so you'll be signed out."
            : "That device is signed out. The user can sign in again right away."
        }
        destructive
        onConfirm={confirm}
        onOpenChange={setOpen}
        open={open}
        title={pending?.kind === "all" ? "Revoke all sessions?" : "Revoke this session?"}
      />
    </Card>
  );
}
