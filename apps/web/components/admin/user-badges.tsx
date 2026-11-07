import { Badge } from "@receipt-ocr/ui/components/badge";
import { planLabel } from "@/lib/plans";

/** Only what differs from a normal account is shown, so the list stays quiet. */
export function UserBadges({
  role,
  plan,
  banned,
  emailVerified,
  twoFactorEnabled,
  passkeys,
  showPlan = false,
}: {
  role: string;
  plan: string;
  banned: boolean;
  emailVerified: boolean;
  twoFactorEnabled: boolean;
  passkeys: number;
  showPlan?: boolean;
}) {
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      {banned ? <Badge variant="destructive">Banned</Badge> : null}
      {role === "admin" ? <Badge>Admin</Badge> : null}
      {role === "admin" && !twoFactorEnabled && passkeys === 0 ? (
        <Badge variant="warning">Admin without 2FA</Badge>
      ) : null}
      {!emailVerified ? <Badge variant="warning">Email not verified</Badge> : null}
      {showPlan ? <Badge variant="secondary">{planLabel(plan)}</Badge> : null}
    </span>
  );
}

export function Initial({ name, email }: { name: string | null; email: string }) {
  return (
    <span
      aria-hidden="true"
      className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/15 font-mono text-sm font-semibold text-primary"
    >
      {(name?.trim() || email).charAt(0).toUpperCase()}
    </span>
  );
}
