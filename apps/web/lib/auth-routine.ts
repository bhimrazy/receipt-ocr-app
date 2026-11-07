/**
 * Read-only endpoints every page and the client poll hit. Only these are
 * routine (sampled when fast and successful); OAuth callbacks, email
 * verification and password resets answer GETs with redirects that can hide a
 * failure, so they are always logged.
 */
const ROUTINE_READS = new Set([
  "get-session",
  "list-sessions",
  "list-accounts",
  "organization/list",
  "organization/get-full-organization",
  "organization/get-active-member",
  "organization/list-members",
  "organization/list-invitations",
]);

/** Whether this auth request is a routine read, for `withRequestEvent`. */
export function isRoutineAuthRead(request: Request): boolean {
  if (request.method !== "GET") return false;
  const endpoint = new URL(request.url).pathname.replace(/^\/api\/auth\//, "").replace(/\/$/, "");
  return ROUTINE_READS.has(endpoint);
}
