import { account, asc, eq, passkey, receipts, sql, user } from "@receipt-ocr/db";
import { Effect } from "effect";
import { Db } from "./services";

/**
 * How a user can sign in (password, Google/GitHub, passkeys) and the checks built on it: the
 * last-method guard on unlinking, the Security checklist and the admin view.
 */

export const SOCIAL_PROVIDERS = ["google", "github"] as const;
export type SocialProviderId = (typeof SOCIAL_PROVIDERS)[number];

export const PROVIDER_LABELS = {
  google: "Google",
  github: "GitHub",
} as const satisfies Record<SocialProviderId, string>;

export const isSocialProvider = (id: string): id is SocialProviderId =>
  (SOCIAL_PROVIDERS as readonly string[]).includes(id);

export interface SignInAccount {
  /** Better Auth's account row id (what /unlink-account takes). */
  id: string;
  providerId: string;
  createdAt: Date;
  /** Only meaningful for `credential`: a row can exist without a password. */
  hasPassword: boolean;
}

export interface SignInMethods {
  email: string;
  emailVerified: boolean;
  twoFactorEnabled: boolean;
  passkeys: number;
  accounts: SignInAccount[];
}

/** One user's sign-in methods, read fresh. Null for an unknown user. */
export const loadSignInMethods = (userId: string) =>
  Effect.flatMap(Db, ({ use }) =>
    use(async (db): Promise<SignInMethods | null> => {
      const [row] = await db
        .select({
          email: user.email,
          emailVerified: user.emailVerified,
          twoFactorEnabled: user.twoFactorEnabled,
          passkeys: sql<number>`(select count(*)::int from ${passkey} p where p.user_id = ${userId})`,
        })
        .from(user)
        .where(eq(user.id, userId))
        .limit(1);
      if (!row) return null;
      const accounts = await db
        .select({
          id: account.id,
          providerId: account.providerId,
          createdAt: account.createdAt,
          hasPassword: sql<boolean>`${account.password} is not null`,
        })
        .from(account)
        .where(eq(account.userId, userId))
        .orderBy(asc(account.createdAt));
      return { ...row, twoFactorEnabled: Boolean(row.twoFactorEnabled), accounts };
    }),
  );

/**
 * Accounts that can still sign in: a credential row with a password, or a provider this
 * deployment has configured (a GitHub row without GitHub configured can't be used).
 */
export const usableAccounts = (
  accounts: readonly SignInAccount[],
  configured: readonly string[],
): SignInAccount[] =>
  accounts.filter((a) =>
    a.providerId === "credential" ? a.hasPassword : configured.includes(a.providerId),
  );

/** Passkeys plus usable accounts. */
export const signInMethodCount = (methods: SignInMethods, configured: readonly string[]) =>
  usableAccounts(methods.accounts, configured).length + methods.passkeys;

/**
 * Whether removing this account leaves at least one way to sign in. An id the user doesn't own
 * passes, so Better Auth answers its own "account not found".
 */
export function canRemoveAccount(
  methods: SignInMethods,
  accountId: string,
  configured: readonly string[],
): boolean {
  if (!methods.accounts.some((a) => a.id === accountId)) return true;
  const rest = methods.accounts.filter((a) => a.id !== accountId);
  return usableAccounts(rest, configured).length + methods.passkeys > 0;
}

/** Whether removing a passkey leaves a way in: another passkey, or a usable account. */
export const canRemovePasskey = (methods: SignInMethods, configured: readonly string[]): boolean =>
  methods.passkeys > 1 || usableAccounts(methods.accounts, configured).length > 0;

/** Completed receipts this user scanned before the one-time "protect your receipts" prompt. */
export const SECURITY_PROMPT_AFTER_RECEIPTS = 5;

/**
 * True when the user has scanned at least SECURITY_PROMPT_AFTER_RECEIPTS receipts (any
 * workspace) and has no passkey. The caller checks two-step sign-in from the session.
 */
export const securityPromptDue = (userId: string) =>
  Effect.flatMap(Db, ({ use }) =>
    use(async (db) => {
      const [row] = await db
        .select({
          passkeys: sql<number>`(select count(*)::int from ${passkey} p where p.user_id = ${userId})`,
          scanned: sql<number>`(select count(*)::int from (select 1 from ${receipts} r where r.user_id = ${userId} and r.status = 'completed' limit ${SECURITY_PROMPT_AFTER_RECEIPTS}) s)`,
        })
        .from(user)
        .where(eq(user.id, userId))
        .limit(1);
      return Boolean(row && row.passkeys === 0 && row.scanned >= SECURITY_PROMPT_AFTER_RECEIPTS);
    }),
  );
