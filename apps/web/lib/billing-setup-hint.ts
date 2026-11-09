const DOMAIN_NOT_APPROVED =
  "Admin: Paddle refused the checkout because the default payment link's domain isn't approved. Approve it in Paddle, My account, Settings, Website approval, then set the link again.";

/**
 * Paddle error codes that mean the Paddle account isn't set up to sell, with the fix. They name
 * dashboard settings, so they are shown to platform admins only; customers keep the generic message.
 */
const HINTS: Record<string, string> = {
  transaction_default_checkout_url_not_set:
    "Admin: Paddle has no default payment link. Set it to this site's /pay page in Paddle, Checkout, Checkout settings.",
  // Paddle's code when the account's default link is on an unapproved domain, and when a
  // transaction's link is (https://developer.paddle.com/errors).
  checkout_url_domain_not_approved: DOMAIN_NOT_APPROVED,
  transaction_checkout_url_domain_is_not_approved: DOMAIN_NOT_APPROVED,
};

/** The fix a platform admin should make for a provider error code, or null for any other failure. */
export function billingSetupHint(code: string | undefined): string | null {
  return code !== undefined && Object.hasOwn(HINTS, code) ? HINTS[code]! : null;
}
