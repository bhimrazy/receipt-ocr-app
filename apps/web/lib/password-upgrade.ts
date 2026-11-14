import "server-only";
import { account, and, eq, type DbClient, user } from "@receipt-ocr/db";
import { errorFields, logger } from "./log";
import { hashPassword, needsRehash, verifyPassword } from "./password";

/**
 * After a correct password sign-in (including one that goes on to two-step sign-in), re-hashes a
 * password stored with older scrypt parameters. Better Auth has no rehash hook, and this is the only
 * moment the plain password is at hand. A failure is logged; the sign-in stands.
 *
 * The row is found the way Better Auth's sign-in finds it, and the password is checked again against
 * the hash about to be replaced: a reset that landed after Better Auth's check (an older instance
 * still writes the old format) must not be overwritten with the previous password.
 */
export async function upgradePasswordHash(db: DbClient, email: string, password: unknown) {
  if (typeof password !== "string") return;
  try {
    const rows = await db
      .select({ id: account.id, hash: account.password, userId: account.userId })
      .from(account)
      .innerJoin(user, eq(user.id, account.userId))
      .where(
        and(
          eq(user.email, email.toLowerCase()),
          eq(account.providerId, "credential"),
          eq(account.accountId, user.id),
        ),
      );
    // More than one credential row has no defined winner; leave it alone.
    const row = rows.length === 1 ? rows[0] : undefined;
    if (!row?.hash || !needsRehash(row.hash)) return;
    if (!(await verifyPassword({ hash: row.hash, password }))) return;
    const upgraded = await hashPassword(password);
    const written = await db
      .update(account)
      .set({ password: upgraded })
      .where(and(eq(account.id, row.id), eq(account.password, row.hash)))
      .returning({ id: account.id });
    if (written.length > 0) {
      logger.info({ event: "auth.password_rehashed", unit: "log", user_id: row.userId });
    }
  } catch (error) {
    logger.error({ event: "auth.password_rehash_failed", unit: "log", error: errorFields(error) });
  }
}
