"use client";

import { Button } from "@receipt-ocr/ui/components/button";
import { ConfirmDialog, type ConfirmDialogProps } from "@receipt-ocr/ui/components/confirm-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@receipt-ocr/ui/components/dropdown-menu";
import { toast } from "@receipt-ocr/ui/components/toast";
import { Ban, LogIn, MoreHorizontal, ShieldOff, ShieldPlus, UserX } from "lucide-react";
import { useState } from "react";
import {
  banUserAction,
  impersonateUserAction,
  revokeUserSessionsAction,
  setRoleAction,
  unbanUserAction,
  type ActionResult,
} from "../actions";
import { BanDialog } from "./ban-dialog";
import type { AdminUser } from "./users-table";

type Confirm = Omit<ConfirmDialogProps, "open" | "onOpenChange">;

/**
 * Per-row admin actions, each confirmed first. The server actions re-check
 * the admin role, so nothing here is trusted authorization.
 */
export function RowActions({
  user,
  currentUserId,
}: {
  user: AdminUser;
  currentUserId: string | null;
}) {
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [banOpen, setBanOpen] = useState(false);
  const isSelf = user.id === currentUserId;
  const who = user.email;

  // Impersonate redirects on success, so its promise resolves without a result.
  function runner(action: () => Promise<ActionResult | undefined>, success?: string) {
    return async (): Promise<string | void> => {
      const result = await action();
      if (result && !result.ok) return result.error ?? "That didn't work. Try again.";
      if (success) toast.add({ title: success, type: "success" });
    };
  }

  function ask(next: Confirm) {
    setConfirm(next);
    setConfirmOpen(true);
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={<Button aria-label={`Actions for ${who}`} size="icon-sm" variant="ghost" />}
        >
          <MoreHorizontal aria-hidden="true" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          {user.role === "admin" ? (
            isSelf ? null : (
              <DropdownMenuItem
                onClick={() =>
                  ask({
                    title: `Remove admin access for ${who}?`,
                    description:
                      "They lose access to the admin area. Their account and receipts stay as they are.",
                    confirmLabel: "Remove admin access",
                    destructive: true,
                    onConfirm: runner(
                      () => setRoleAction(user.id, "user"),
                      `${who} is no longer an admin.`,
                    ),
                  })
                }
              >
                <ShieldOff aria-hidden="true" />
                Remove admin access
              </DropdownMenuItem>
            )
          ) : (
            <DropdownMenuItem
              onClick={() =>
                ask({
                  title: `Make ${who} an admin?`,
                  description:
                    "They can see every user and workspace, ban people and impersonate accounts.",
                  confirmLabel: "Make admin",
                  onConfirm: runner(
                    () => setRoleAction(user.id, "admin"),
                    `${who} is now an admin.`,
                  ),
                })
              }
            >
              <ShieldPlus aria-hidden="true" />
              Make admin
            </DropdownMenuItem>
          )}
          <DropdownMenuItem
            onClick={() =>
              ask({
                title: `Sign ${who} out everywhere?`,
                description: isSelf
                  ? "This ends all your sessions, including this one. You'll need to sign in again."
                  : "This ends all their sessions. They can sign in again right away.",
                confirmLabel: "Revoke sessions",
                destructive: true,
                onConfirm: runner(
                  () => revokeUserSessionsAction(user.id),
                  `Signed ${who} out everywhere.`,
                ),
              })
            }
          >
            <UserX aria-hidden="true" />
            Revoke sessions
          </DropdownMenuItem>
          {isSelf ? null : (
            <>
              <DropdownMenuItem
                onClick={() =>
                  ask({
                    title: `Impersonate ${who}?`,
                    description:
                      "You'll be signed in as them, and everything you do runs as this user until you stop impersonating.",
                    confirmLabel: "Impersonate",
                    confirmText: who,
                    onConfirm: runner(() => impersonateUserAction(user.id)),
                  })
                }
              >
                <LogIn aria-hidden="true" />
                Impersonate
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              {user.banned ? (
                <DropdownMenuItem
                  onClick={() =>
                    ask({
                      title: `Unban ${who}?`,
                      description: "They can sign in again straight away.",
                      confirmLabel: "Unban",
                      onConfirm: runner(() => unbanUserAction(user.id), `${who} is unbanned.`),
                    })
                  }
                >
                  <Ban aria-hidden="true" />
                  Unban
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem onClick={() => setBanOpen(true)} variant="destructive">
                  <Ban aria-hidden="true" />
                  Ban
                </DropdownMenuItem>
              )}
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {confirm ? (
        <ConfirmDialog onOpenChange={setConfirmOpen} open={confirmOpen} {...confirm} />
      ) : null}

      <BanDialog
        onOpenChange={setBanOpen}
        onSubmit={(reason, expiresInSeconds) =>
          runner(() => banUserAction(user.id, reason, expiresInSeconds), `${who} is banned.`)()
        }
        open={banOpen}
        userEmail={who}
      />
    </>
  );
}
