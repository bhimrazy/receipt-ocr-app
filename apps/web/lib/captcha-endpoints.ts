/** Better Auth's captcha defaults (sign-up, sign-in, password reset) plus the resend-confirmation link. */
export const CAPTCHA_ENDPOINTS = [
  "/sign-up/email",
  "/sign-in/email",
  "/request-password-reset",
  "/send-verification-email",
] as const;
