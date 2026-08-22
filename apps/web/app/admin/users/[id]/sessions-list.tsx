"use client";

import { Badge } from "@receipt-ocr/ui/components/badge";
import { Button } from "@receipt-ocr/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@receipt-ocr/ui/components/card";
import { Monitor, ShieldX } from "lucide-react";
import { useState, useTransition } from "react";
import { revokeUserSessionAction, revokeUserSessionsAction } from "../../actions";

export interface AdminSession {
  id: string;
  token: string;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
  expiresAt: string;
  impersonatedBy: string | null;
}

export function SessionsList({
  sessions,
  userId,
}: {
  sessions: AdminSession[];
  userId: string;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function run(action: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) setError(result.error ?? "Action failed");
    });
  }

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle>Active sessions ({sessions.length})</CardTitle>
        {sessions.length > 0 ? (
          <Button
            disabled={pending}
            onClick={() => run(() => revokeUserSessionsAction(userId))}
            size="sm"
            variant="outline"
          >
            <ShieldX className="size-4" />
            Revoke all
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-2">
        {error ? (
          <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
            {error}
          </p>
        ) : null}
        {sessions.length === 0 ? (
          <p className="text-sm text-muted-foreground">No active sessions.</p>
        ) : (
          sessions.map((session) => (
            <div
              className="flex items-center justify-between gap-3 rounded-lg border border-border bg-background/40 px-3 py-2.5"
              key={session.id}
            >
              <div className="flex min-w-0 items-center gap-3">
                <Monitor className="size-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0">
                  <div className="truncate text-sm">
                    {session.userAgent || "Unknown device"}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {session.ipAddress || "no ip"} · expires{" "}
                    {new Date(session.expiresAt).toLocaleDateString()}
                  </div>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {session.impersonatedBy ? (
                  <Badge variant="secondary">Impersonated</Badge>
                ) : null}
                <Button
                  disabled={pending}
                  onClick={() => run(() => revokeUserSessionAction(session.token, userId))}
                  size="sm"
                  variant="ghost"
                >
                  Revoke
                </Button>
              </div>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
