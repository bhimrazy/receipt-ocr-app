/** The words shown when a batch is full. */
export function batchFullMessage(max: number) {
  return `Up to ${max} receipts at a time. Upload these first, then add more.`;
}

/**
 * Keeps the first items that fit in what's left of the batch. `notice` says what was left
 * out, or is null when everything fit.
 */
export function fitBatch<T>(incoming: T[], inBatch: number, max: number) {
  const room = Math.max(0, max - inBatch);
  const kept = incoming.slice(0, room);
  const dropped = incoming.length - kept.length;
  const notice =
    dropped === 0
      ? null
      : kept.length === 0
        ? batchFullMessage(max)
        : `Added the first ${kept.length}; ${dropped} left out. ${batchFullMessage(max)}`;
  return { kept, dropped, notice };
}
