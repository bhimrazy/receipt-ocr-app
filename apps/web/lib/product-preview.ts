/** Sales tax on the landing page's sample receipt. */
const PREVIEW_TAX_RATE = 0.08;

/** Subtotal, tax and total for the sample receipt's line prices, in cents so they add up exactly. */
export function previewTotals(prices: readonly number[]) {
  const subtotal = prices.reduce((sum, price) => sum + Math.round(price * 100), 0);
  const tax = Math.round(subtotal * PREVIEW_TAX_RATE);
  return { subtotal: subtotal / 100, tax: tax / 100, total: (subtotal + tax) / 100 };
}
