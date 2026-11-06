import type { ReceiptCounts } from "@receipt-ocr/core";

/** Changes whenever any receipt count does; list pollers compare it to decide on a refresh. */
export const countsKey = (c: ReceiptCounts) =>
  `${c.total}:${c.needsReview}:${c.failed}:${c.inFlight}`;
