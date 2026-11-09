/** A Paddle transaction id: `txn_` and 26 lowercase letters or digits (https://developer.paddle.com/api-reference/about/paddle-ids). */
const TRANSACTION_ID = /^txn_[a-z\d]{26}$/;

export type PaymentLink =
  { kind: "none" } | { kind: "invalid" } | { kind: "transaction"; transactionId: string };

/**
 * Reads `/pay`'s `_ptxn` query value. Anything but exactly one well-formed transaction id is
 * `invalid`, so nothing else from the URL ever reaches the page or Paddle.js.
 */
export function parsePaymentLink(value: string | string[] | undefined): PaymentLink {
  if (value === undefined) return { kind: "none" };
  if (typeof value !== "string" || !TRANSACTION_ID.test(value)) return { kind: "invalid" };
  return { kind: "transaction", transactionId: value };
}
