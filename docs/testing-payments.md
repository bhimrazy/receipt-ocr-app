# Testing payments

A walkthrough for checking the Pro checkout end to end without spending money. How billing works is in
[the billing flow](architecture/flows/billing.md); setting up Paddle is in
[production-environment.md §10](production-environment.md#10-payments-paddle).

## Where it runs today

Production uses Paddle's **sandbox** (test mode, `PADDLE_ENV=sandbox`). Only platform admins see a checkout, and it's
marked "Test mode: no real charge"; everyone else sees "Pro checkout opens soon" on `/pricing`. Nothing real is charged.
Upgrade prompts elsewhere in the app stay hidden until checkout opens to everyone, so test those on a PR preview.

## Steps

1. **Open checkout.** Sign in on https://receipt-ocr.bhimraj.com.np as an admin, open **Settings → Billing** in a
   workspace you own, and click **Upgrade**. Pick monthly or yearly.
2. **Pay with a test card.** `4242 4242 4242 4242`, any future expiry, any CVC. Paddle's "test payment methods" page
   lists cards that are declined or ask for 3-D Secure, for checking the failure paths.
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

| What you see                       | Look at                                                                                        |
| ---------------------------------- | ---------------------------------------------------------------------------------------------- |
| No Upgrade button                  | You're not an admin, not the workspace owner, or a Paddle config value is missing or Sensitive |
| "Checkout couldn't load"           | A content blocker is stopping Paddle.js; turn it off for the page                              |
| Paid, but the workspace stays Free | The webhook destination's URL and secret, then its delivery logs                               |
| Job outcome `unmatched`            | Buyer isn't the owner, the workspace is gone, or the price isn't a `PADDLE_PRICE_PRO_*` id     |

## Going live

[production-environment.md §10c](production-environment.md#10c-switch-from-sandbox-to-live) lists the switch. After
it, make one real purchase with your own card, repeat steps 3 and 4, then refund it in Paddle.
