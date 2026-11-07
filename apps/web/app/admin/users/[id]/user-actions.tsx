"use client";

import { clearSharedFiles } from "@/lib/share-target";
import type { PlanTable } from "@receipt-ocr/core/plans";
import { Button } from "@receipt-ocr/ui/components/button";
import { ConfirmDialog, type ConfirmDialogProps } from "@receipt-ocr/ui/components/confirm-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@receipt-ocr/ui/components/select";
import { toast } from "@receipt-ocr/ui/components/toast";
import { Ban, LogIn, MailCheck, ShieldCheck, Trash2 } from "lucide-react";
import { useState } from "react";
import { ReasonDialog } from "@/components/admin/reason-dialog";
import { formatDateTime } from "@/lib/format";
import {
  banUserAction,
  deleteUserAction,
  impersonateUserAction,
  resendVerificationAction,
  setPlanAction,
  setRoleAction,
  unbanUserAction,
  type ActionResult,
} from "../../actions";

export type ActionUser = {
  id: string;
  email: string;
  role: string;
  plan: string;
  banned: boolean;
  banExpires: string | null;
  emailVerified: boolean;
  /** Workspaces only this user belongs to: deleted with them. */
  soloWorkspaces: number;
};

type Confirm = Omit<ConfirmDialogProps, "open" | "onOpenChange">;

const PLAN_ITEMS = [
  { value: "free", label: "Free" },
  { value: "pro", label: "Pro" },
];
const ROLE_ITEMS = [
  { value: "user", label: "User" },
  { value: "admin", label: "Admin" },
];
const BAN_LENGTHS = [
  { value: "1", label: "1 day" },
  { value: "7", label: "7 days" },
  { value: "30", label: "30 days" },
  { value: "", label: "Until lifted" },
];

const n = (value: number) => value.toLocaleString("en-US");

/** Toast on success; the error string keeps a dialog open and shows inline. */
async function settle(promise: Promise<ActionResult>, success: string): Promise<string | void> {
  const result = await promise;
  if (!result.ok) return result.error;
  toast.add({ title: success, type: "success" });
}

function Row({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="text-sm font-medium">{label}</p>
        {hint ? <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p> : null}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

export function AccountControls({
  user,
  plans,
  isSelf,
}: {
  user: ActionUser;
  plans: PlanTable;
  isSelf: boolean;
}) {
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [open, setOpen] = useState(false);
  const ask = (next: Confirm) => {
    setConfirm(next);
    setOpen(true);
  };
  const who = user.email;

  return (
    <>
      <div className="divide-y divide-border">
        <Row
          hint={`${n(plans[user.plan as "free" | "pro"]?.receiptsPerDay ?? 0)} receipts a day, ${n(plans[user.plan as "free" | "pro"]?.workspaces ?? 0)} owned workspaces.`}
          label="Plan"
        >
          <Select
            items={PLAN_ITEMS}
            onValueChange={(next) => {
              if (!next || next === user.plan) return;
              const limits = plans[next as "free" | "pro"];
              ask({
                title: `Move ${who} to the ${next === "pro" ? "Pro" : "Free"} plan?`,
                description: `Their limits become ${n(limits.receiptsPerDay)} receipts a day, ${n(limits.receiptsPerMinute)} a minute and ${n(limits.workspaces)} owned ${limits.workspaces === 1 ? "workspace" : "workspaces"}. This applies to their next upload. Nobody is charged.`,
                confirmLabel: "Change plan",
                onConfirm: () =>
                  settle(setPlanAction({ userId: user.id, plan: next }), "Plan changed."),
              });
            }}
            value={user.plan}
          >
            <SelectTrigger aria-label="Plan" className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent alignItemWithTrigger={false}>
              {PLAN_ITEMS.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Row>

        <Row
          hint={
            isSelf
              ? "You can't change your own role."
              : "Admins can see every account and use this panel."
          }
          label="Role"
        >
          <Select
            disabled={isSelf}
            items={ROLE_ITEMS}
            onValueChange={(next) => {
              if (!next || next === user.role) return;
              const toAdmin = next === "admin";
              ask({
                title: toAdmin ? `Make ${who} an admin?` : `Remove admin access for ${who}?`,
                description: toAdmin
                  ? "They can see every user and workspace, ban people, change limits and sign in as other users."
                  : "They lose access to this panel. Their account and receipts stay as they are.",
                confirmLabel: toAdmin ? "Make admin" : "Remove admin access",
                destructive: !toAdmin,
                onConfirm: () =>
                  settle(
                    setRoleAction({ userId: user.id, role: next as "user" | "admin" }),
                    "Role changed.",
                  ),
              });
            }}
            value={user.role === "admin" ? "admin" : "user"}
          >
            <SelectTrigger aria-label="Role" className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent alignItemWithTrigger={false}>
              {ROLE_ITEMS.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Row>

        <Row
          hint={
            user.emailVerified
              ? "They confirmed their email address."
              : "They haven't opened the link in the verification email yet."
          }
          label={user.emailVerified ? "Email verified" : "Email not verified"}
        >
          {user.emailVerified ? (
            <MailCheck aria-hidden="true" className="size-5 text-primary" />
          ) : (
            <Button
              onClick={() =>
                ask({
                  title: `Send a new verification email to ${who}?`,
                  description: "The old link stops working. The new one is valid for one hour.",
                  confirmLabel: "Send email",
                  onConfirm: () =>
                    settle(
                      resendVerificationAction({ userId: user.id }),
                      "Verification email sent.",
                    ),
                })
              }
              size="sm"
              variant="outline"
            >
              Resend verification email
            </Button>
          )}
        </Row>
      </div>

      {confirm ? <ConfirmDialog onOpenChange={setOpen} open={open} {...confirm} /> : null}
    </>
  );
}

export function DangerZone({ user, isSelf }: { user: ActionUser; isSelf: boolean }) {
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [open, setOpen] = useState(false);
  const [banOpen, setBanOpen] = useState(false);
  const [banDays, setBanDays] = useState("7");
  const [impersonateOpen, setImpersonateOpen] = useState(false);
  const ask = (next: Confirm) => {
    setConfirm(next);
    setOpen(true);
  };
  const who = user.email;
  const blockedReason = isSelf
    ? "This is your own account."
    : user.role === "admin"
      ? "Remove their admin role first."
      : null;

  return (
    <>
      <div className="divide-y divide-border">
        <Row
          hint={
            blockedReason ??
            "See the app as they see it. Everything you do runs as them. Your reason is recorded."
          }
          label="Sign in as this user"
        >
          <Button
            disabled={Boolean(blockedReason) || user.banned}
            onClick={() => setImpersonateOpen(true)}
            size="sm"
            variant="outline"
          >
            <LogIn aria-hidden="true" />
            Sign in as user
          </Button>
        </Row>

        {user.banned ? (
          <Row
            hint={
              user.banExpires
                ? `Banned until ${formatDateTime(user.banExpires)}.`
                : "Banned until someone lifts the ban."
            }
            label="Lift the ban"
          >
            <Button
              onClick={() =>
                ask({
                  title: `Lift the ban on ${who}?`,
                  description: "They can sign in again straight away.",
                  confirmLabel: "Lift ban",
                  onConfirm: () => settle(unbanUserAction({ userId: user.id }), "Ban lifted."),
                })
              }
              size="sm"
              variant="outline"
            >
              <ShieldCheck aria-hidden="true" />
              Lift ban
            </Button>
          </Row>
        ) : (
          <Row
            hint={blockedReason ?? "Signs them out now and blocks sign-in."}
            label="Ban this user"
          >
            <Button
              disabled={Boolean(blockedReason)}
              onClick={() => setBanOpen(true)}
              size="sm"
              variant="destructive"
            >
              <Ban aria-hidden="true" />
              Ban user
            </Button>
          </Row>
        )}

        <Row
          hint={
            isSelf
              ? "Delete your own account from Settings in the app."
              : (blockedReason ?? "Removes the account for good. You type their email to confirm.")
          }
          label="Delete this user"
        >
          <Button
            disabled={Boolean(blockedReason)}
            onClick={() =>
              ask({
                title: `Delete ${who}?`,
                description:
                  `This deletes their account and sessions` +
                  (user.soloWorkspaces > 0
                    ? `, and the ${user.soloWorkspaces === 1 ? "workspace" : `${user.soloWorkspaces} workspaces`} only they belong to, with every receipt and image in ${user.soloWorkspaces === 1 ? "it" : "them"}`
                    : "") +
                  ". Receipts they added to shared workspaces stay there. This can't be undone.",
                confirmLabel: "Delete user",
                confirmText: who,
                destructive: true,
                onConfirm: (typed) =>
                  settle(deleteUserAction({ userId: user.id, confirm: typed }), "User deleted."),
              })
            }
            size="sm"
            variant="destructive"
          >
            <Trash2 aria-hidden="true" />
            Delete user
          </Button>
        </Row>
      </div>

      {confirm ? <ConfirmDialog onOpenChange={setOpen} open={open} {...confirm} /> : null}

      <ReasonDialog
        confirmLabel="Ban user"
        description="They're signed out on every device now and can't sign in until the ban ends or you lift it."
        destructive
        minLength={3}
        onOpenChange={setBanOpen}
        onSubmit={(reason) =>
          settle(
            banUserAction({
              userId: user.id,
              reason,
              days: banDays ? (Number(banDays) as 1 | 7 | 30) : null,
            }),
            `${who} is banned.`,
          )
        }
        open={banOpen}
        reasonHint="Kept in the audit log. The user isn't shown this."
        reasonLabel="Reason"
        title={`Ban ${who}?`}
      >
        <fieldset>
          <legend className="mb-2 text-sm font-medium">How long</legend>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {BAN_LENGTHS.map((length) => (
              <label className="relative" key={length.label}>
                <input
                  checked={banDays === length.value}
                  className="peer sr-only"
                  name="ban-length"
                  onChange={() => setBanDays(length.value)}
                  type="radio"
                  value={length.value}
                />
                <span className="flex min-h-11 cursor-pointer items-center justify-center rounded-lg border border-input px-2 text-sm transition peer-checked:border-primary peer-checked:bg-primary/10 peer-checked:text-primary peer-focus-visible:ring-2 peer-focus-visible:ring-ring md:min-h-9">
                  {length.label}
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      </ReasonDialog>

      <ReasonDialog
        confirmLabel="Sign in as user"
        description="You'll leave the admin panel and use the app as this user until you select Stop impersonating in the banner."
        minLength={10}
        onOpenChange={setImpersonateOpen}
        onSubmit={(reason) =>
          settle(
            clearSharedFiles().then(() => impersonateUserAction({ userId: user.id, reason })),
            "Signed in.",
          )
        }
        open={impersonateOpen}
        reasonHint="Kept in the audit log with the start and end time. For example: the support request you are answering."
        reasonLabel="Why do you need to sign in as them?"
        title={`Sign in as ${who}?`}
      />
    </>
  );
}
