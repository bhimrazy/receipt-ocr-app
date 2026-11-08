/**
 * Pro's list prices in US dollars, before sales tax or VAT (Paddle adds it at
 * checkout). The Paddle price ids (PADDLE_PRICE_PRO_MONTHLY / _YEARLY) must
 * charge these amounts; the pricing page and the terms print them.
 */
export const PRO_PRICE = { month: 9, year: 90 } as const;

export const PRO_PRICE_LABEL = {
  month: `$${PRO_PRICE.month}`,
  year: `$${PRO_PRICE.year}`,
} as const;

/** Days after a subscription's first payment in which it can be refunded in full. */
export const REFUND_DAYS = 14;
