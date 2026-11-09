# Testing payments

A walkthrough for checking the Pro checkout end to end without spending money. How billing works is in
[the billing flow](architecture/flows/billing.md); setting up Paddle is in
[production-environment.md §10](production-environment.md#10-payments-paddle).

## Where it runs today

Production uses Paddle's **sandbox** (test mode, `PADDLE_ENV=sandbox`). Only platform admins see a checkout, and it's
marked "Test mode: no real charge"; everyone else sees "Pro checkout opens soon" on `/pricing`. Nothing real is charged.
Upgrade prompts elsewhere in the app stay hidden until checkout opens to everyone, so test those on a PR preview.

The sandbox default payment link was set to `https://receipt-ocr.bhimraj.com.np/` over the API on 2026-11-09; it gets
repointed to `/pay` once `/pay` is deployed ([§10](production-environment.md#paddle-account-settings)).

## Steps

1. **Open checkout.** Sign in on https://receipt-ocr.bhimraj.com.np as an admin, open **Settings → Billing** in a
   workspace you own, and click **Upgrade**. Pick monthly or yearly.
2. **Pay with a test card.** `4242 4242 4242 4242`, any name, any future expiry, CVV `100`. `4000 0000 0000 0002` is
   declined; Paddle's [test cards](https://developer.paddle.com/concepts/payment-methods/card) page lists more,
   including 3-D Secure.
3. **See Pro arrive.** The page says "Payment received" and refreshes until the workspace is Pro, usually within a few
   seconds.
4. **Check it went through.**
   - **Admin → Jobs** (`/admin/jobs`): the `billing.apply_event` jobs are `succeeded`. A `dead` job names the problem
     in its logs.
   - **Paddle sandbox → Developer tools → Notifications → the destination → Logs**: each delivery shows 200. A 401
     means the webhook secret is wrong or the server clock is far off.
5. **Cancel.** **Billing → Cancel subscription** opens Paddle's portal. Afterwards the page says Pro stays until the end
   of the period.
6. **Refund.** In Paddle, refund the test transaction in full. The workspace drops to Free at once, and the
   subscription shows as canceled in Paddle shortly after.

## If something's off

| What you see                               | Look at                                                                                                                                                                                                                                                                                                   |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No Upgrade button                          | You're not an admin, not the workspace owner, or a Paddle config value is missing or Sensitive                                                                                                                                                                                                            |
| "The checkout couldn't start"              | Paddle refused the server's call. Find `billing.checkout_failed` in the logs: `error.kind` says why (`http-400`, `http-401`, `http-403`, `network`, `timeout`) and `billing.provider_error_code` has Paddle's own code. As a platform admin the button names the fix for an account-setup code            |
| `transaction_default_checkout_url_not_set` | No default payment link: Paddle → Checkout → Checkout settings → Default payment link, set to `https://receipt-ocr.bhimraj.com.np/pay` ([§10](production-environment.md#paddle-account-settings)). In live it must be on an approved domain (`transaction_checkout_url_domain_is_not_approved` otherwise) |
| `http-401`                                 | `PADDLE_API_KEY` is wrong, revoked, from the other environment, or **expired** (Paddle's default expiry is 90 days)                                                                                                                                                                                       |
| `http-403`                                 | The API key lacks a permission: it needs `customer.write`, `transaction.write`, `customer_portal_session.write` and `subscription.write`                                                                                                                                                                  |
| Overlay opens with "Something went wrong"  | Default payment link missing, or (live) the domain isn't approved yet                                                                                                                                                                                                                                     |
| "Checkout couldn't load"                   | A content blocker is stopping Paddle.js; turn it off for the page                                                                                                                                                                                                                                         |
| Paid, but the workspace stays Free         | The webhook destination's URL and secret, then its delivery logs. Sandbox gives up after 3 tries in about two minutes: replay the delivery once it's fixed                                                                                                                                                |
| Job outcome `unmatched`                    | Buyer isn't the owner, the workspace is gone, or the price isn't a `PADDLE_PRICE_PRO_*` id                                                                                                                                                                                                                |

Test with a real checkout (the steps above). `POST /transactions/preview` doesn't check the default payment link, the
customer or the domain, so it passes while real checkouts fail.

## Going live

[production-environment.md §10c](production-environment.md#10c-switch-from-sandbox-to-live) lists the switch. After
it, make one real purchase with your own card, repeat steps 3 and 4, then refund it in Paddle.
