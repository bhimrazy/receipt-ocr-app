/**
 * First keys of the two-key advisory locks (`pg_advisory_xact_lock(namespace, hashtext(id))`).
 * Each resource has its own namespace, so a lock on one never blocks or admits another; a new lock
 * takes the next free number here.
 */
export const LOCK_NAMESPACES = {
  user: 7_301,
  workspace: 7_302,
  subscription: 7_303,
  support: 7_304,
  groups: 7_305,
} as const;
