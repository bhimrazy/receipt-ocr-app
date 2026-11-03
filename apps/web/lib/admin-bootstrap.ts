/**
 * True when this user should be granted the admin role from ADMIN_EMAILS.
 * Requires a verified address: the list names an email, and only verification
 * proves the account holder owns it.
 */
export function isBootstrapAdmin(
  user: { email: string; emailVerified: boolean },
  adminEmails: readonly string[],
): boolean {
  return user.emailVerified && adminEmails.includes(user.email.trim().toLowerCase());
}
