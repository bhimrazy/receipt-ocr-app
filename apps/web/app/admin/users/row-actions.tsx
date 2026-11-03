"use client";

import { Button } from "@receipt-ocr/ui/components/button";
import { Ban, LogIn, MoreHorizontal, ShieldOff, ShieldPlus, UserX } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTransition } from "react";
import {
  banUserAction,
  impersonateUserAction,
  revokeUserSessionsAction,
  setRoleAction,
  unbanUserAction,
} from "../actions";
import type { AdminUser } from "./users-table";
import { BanDialog } from "./ban-dialog";

/**
 * Per-row admin actions. Every action goes through a server action that
 * re-verifies the admin role — nothing here is trusted authorization.
 */
export function RowActions({ user }: { user: AdminUser }) {
  const [open, setOpen] = useState(false);
  const [banOpen, setBanOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  function run(action: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null);
    setOpen(false);
    startTransition(async () => {
      // Actions that redirect (impersonate) resolve to undefined on the client.
      const result = await action();
      if (result && !result.ok) setError(result.error ?? "Action failed");
    });
  }

  const menuItemClass =
    "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-muted-foreground transition hover:bg-foreground/[0.06] hover:text-foreground disabled:opacity-50";

  return (
    <div className="relative inline-block text-left" ref={ref}>
      <Button
        aria-label="Row actions"
        disabled={pending}
        onClick={() => setOpen((value) => !value)}
        size="sm"
        variant="ghost"
      >
        <MoreHorizontal className="size-4" />
      </Button>
      {open ? (
        <div
          className="absolute right-0 top-9 z-50 w-52 rounded-xl border border-border bg-card p-1.5 text-left shadow-2xl"
          role="menu"
        >
          {user.role === "admin" ? (
            <button
              className={menuItemClass}
              onClick={() => run(() => setRoleAction(user.id, "user"))}
              type="button"
            >
              <ShieldOff className="size-4" />
              Demote to user
            </button>
          ) : (
            <button
              className={menuItemClass}
              onClick={() => run(() => setRoleAction(user.id, "admin"))}
              type="button"
            >
              <ShieldPlus className="size-4" />
              Promote to admin
            </button>
          )}
          {user.banned ? (
            <button
              className={menuItemClass}
              onClick={() => run(() => unbanUserAction(user.id))}
              type="button"
            >
              <Ban className="size-4" />
              Unban user
            </button>
          ) : (
            <button
              className={menuItemClass}
              onClick={() => {
                setOpen(false);
                setBanOpen(true);
              }}
              type="button"
            >
              <Ban className="size-4" />
              Ban user
            </button>
          )}
          <button
            className={menuItemClass}
            onClick={() => run(() => revokeUserSessionsAction(user.id))}
            type="button"
          >
            <UserX className="size-4" />
            Revoke sessions
          </button>
          <button
            className={menuItemClass}
            onClick={() => run(() => impersonateUserAction(user.id))}
            type="button"
          >
            <LogIn className="size-4" />
            Impersonate
          </button>
        </div>
      ) : null}

      {error ? (
        <p className="absolute right-0 top-9 z-40 mt-9 w-52 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-left text-xs text-red-300">
          {error}
        </p>
      ) : null}

      <BanDialog
        onClose={() => setBanOpen(false)}
        onSubmit={(reason, expiresInSeconds) =>
          run(() => banUserAction(user.id, reason, expiresInSeconds))
        }
        open={banOpen}
        userEmail={user.email}
      />
    </div>
  );
}
