/**
 * Per-path limits for Better Auth's rate limiter (per client IP, stored in the database).
 * Pinned by a unit test: the e2e sign-up helper uses a fresh IP per call to stay under the
 * sign-up limit, so nothing else would notice if it were loosened.
 */
export const authRateLimitRules = {
  "/sign-in/email": { window: 60, max: 5 },
  "/sign-up/email": { window: 60, max: 3 },
  // Per IP; auth-guards also caps each inviter.
  "/organization/invite-member": { window: 60 * 60, max: 20 },
  // Requesting and completing account deletion, and email changes; email-limits also caps each address.
  "/delete-user": { window: 60 * 60, max: 10 },
  "/change-email": { window: 60 * 60, max: 10 },
} as const;
