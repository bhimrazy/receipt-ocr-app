// Shared by seed.js and load.js (k6 scripts: plain ES modules run by k6, not Node).
import http from "k6/http";

export const BASE_URL = __ENV.BASE_URL || "http://app:3000";
export const USERS = Number(__ENV.USERS || 50);
export const RECEIPTS_PER_USER = Number(__ENV.RECEIPTS || 200);
export const PASSWORD = "load-password-123";
export const SESSION_COOKIE = "better-auth.session_token";

export const emailOf = (i) => `load-${i}@example.com`;

// One IP per simulated user, so per-IP rate limits (sign-in, sign-up) see many clients, like real traffic.
// Needs TRUSTED_IP_HEADERS=x-forwarded-for on the app.
export const ipOf = (i) => `10.${(i >> 8) & 255}.${i & 255}.7`;

// Deterministic receipt ids; bench/load/seed.sql builds the same ones.
export function receiptId(user, n) {
  return `00000000-0000-4000-8000-${(user * 10000 + n).toString(16).padStart(12, "0")}`;
}

export function postJson(path, body, user) {
  return http.post(`${BASE_URL}${path}`, JSON.stringify(body), {
    headers: {
      "Content-Type": "application/json",
      Origin: BASE_URL,
      "X-Forwarded-For": ipOf(user),
    },
    jar: new http.CookieJar(),
  });
}
