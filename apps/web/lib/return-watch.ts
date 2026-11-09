/** How long the installed app must have been in the background before its data counts as stale. */
export const REFRESH_AFTER_HIDDEN_MS = 60_000;

/**
 * Calls `onReturn` when the page becomes visible again after more than `afterMs` hidden. Time is
 * counted from the moment it was hidden, so short app switches (a code from Messages) don't
 * refetch. Returns the cleanup.
 */
export function watchReturn({
  afterMs = REFRESH_AFTER_HIDDEN_MS,
  isHidden,
  now,
  onReturn,
  onVisibilityChange,
}: {
  afterMs?: number;
  isHidden: () => boolean;
  now: () => number;
  onReturn: () => void;
  onVisibilityChange: (listener: () => void) => () => void;
}): () => void {
  let hiddenAt: number | null = isHidden() ? now() : null;
  return onVisibilityChange(() => {
    if (isHidden()) {
      hiddenAt ??= now();
      return;
    }
    const away = hiddenAt === null ? 0 : now() - hiddenAt;
    hiddenAt = null;
    if (away > afterMs) onReturn();
  });
}
