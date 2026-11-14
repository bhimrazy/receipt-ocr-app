# Paddle sandbox tests

Manual checks of how the app applies Paddle's billing events, run in the Paddle **sandbox** against a deploy whose
webhook destination points at it. How billing works is in [the billing flow](../architecture/flows/billing.md); the
checkout walkthrough with the error table is [testing-payments.md](../testing-payments.md).

Run them:

- before switching Paddle to live ([§10c](../production-environment.md#10c-switch-from-sandbox-to-live));
- after any change to `packages/core/src/billing` or the webhook route;
- after changing which events the destination sends ([§10a](../production-environment.md#10a-webhook-destination)).

## Prerequisites

- The sandbox account set up as in [§10](../production-environment.md#10-payments-paddle), with its webhook destination
  on the deploy under test, and a platform admin account there that owns a workspace on Free.
- Read-only access to that deploy's database, for the checks below.
- Test cards: `4242 4242 4242 4242` with any name, any future expiry and CVC `100` (succeeds);
  `4000 0000 0000 0002` (declined); `4000 0038 0000 0446` (asks for 3-D Secure).

Paddle refuses subscription changes within 30 minutes of the next billing date and while the subscription is
`past_due`, and every recurring item on a subscription must share one billing interval: replace the price rather than
adding a second one.

## Checkout and refund

- [ ] **Checkout.** Settings → Billing → Upgrade, monthly, card `4242…`. The workspace turns Pro within seconds.
- [ ] **Declined card.** Retry a checkout in another workspace with `4000 0000 0000 0002`: Paddle shows the decline and
      the workspace stays Free.
- [ ] **3-D Secure.** Same with `4000 0038 0000 0446`: complete the challenge and the workspace turns Pro.
- [ ] **Cancel from the app.** Billing → Cancel subscription (Paddle's portal). The page says Pro lasts until the period
      end; the row has `cancel_at_period_end = true`.
- [ ] **Full refund.** Paddle → Transactions → the checkout transaction → Refund, full. The workspace drops to Free at
      once and the subscription turns `canceled` shortly after.

## Subscription changes from the dashboard

Start from an active monthly subscription. If its cancel is scheduled, step 1 removes it. Each step's events and the
outcome the app should record:

| Step                                                                                                                                                                | Paddle sends                                                                                                                                                                                                                                     | The app records                                                                                                                                                                                                          |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1. Paddle → Customers → the customer → the subscription → **Don't cancel**                                                                                          | `subscription.updated` with `scheduled_change: null`                                                                                                                                                                                             | `applied`; `cancel_at_period_end = false`; still Pro                                                                                                                                                                     |
| 2. **Edit subscription** → replace the monthly price with the yearly one → turn on **Charge for what's remaining of the current billing period?** → Continue → Save | `subscription.updated` with a new yearly period from now; `transaction.completed`, origin `subscription_update`, billing period the new year, two items: the yearly price unprorated and the monthly price at quantity −1, prorated (the credit) | Both `applied`. The row is yearly, and `paid_transaction_id` is this transaction with `paid_period_start` the new period's start: it paid a full price for a new period, so refunding it in full ends Pro                |
| 3. **Change next billing date** → a later date, Billing date **Now** → Save                                                                                         | `subscription.updated` with the period end moved; `transaction.completed`, origin `subscription_update`, billing period from the unchanged start to the new end, one item, prorated over the added days                                          | `subscription.updated` `applied`: `current_period_end` is the new date and Pro lasts until then. `transaction.completed` `ignored`: only prorated items, so `paid_transaction_id` and `paid_period_start` stay at step 2 |
| 4. **Cancel subscription** → confirm                                                                                                                                | `subscription.updated` and `subscription.canceled`, status `canceled`, no period; a `transaction.canceled` for an unpaid card-check transaction (not subscribed, answered 200 and dropped)                                                       | Both `applied`; status `canceled`, `cancel_at_period_end = false`: **Pro ends at once**                                                                                                                                  |

The dashboard's Cancel subscription cancels **immediately**, with no refund of the time left. A customer cancelling from
the app's Billing page (Paddle's portal) cancels at the period end instead.

Whether a `subscription_update` transaction pays a new period comes from its items: one with a positive quantity and no
`proration` means it does; only prorated items means it doesn't. The rule is in `paysPeriod`
(`packages/core/src/billing/entitlement.ts`).

## Checking the outcomes

Read the events back, newest first (read-only, on the deploy's database):

```sql
select received_at, event_type, outcome,
  payload->'transaction'->>'origin' as origin,
  payload->'transaction'->'lines' as lines,
  payload->'subscription'->>'status' as status,
  payload->'subscription'->>'currentPeriodEnd' as period_end
from billing_events
where provider = 'paddle' and received_at > now() - interval '1 hour'
order by received_at desc;
```

Then the subscription row: `status`, `billing_interval`, `current_period_end`, `cancel_at_period_end`,
`paid_transaction_id`, `paid_period_start` and `revoked_at` in `billing_subscriptions`. The `billing.apply_event` jobs in
Admin → Jobs should all be `succeeded`.

Keep raw payloads out of the repository: they name customers, addresses and cards. A fixture for a test keeps only the
fields the code reads, with placeholder ids, like `packages/core/tests/billing/fixtures/`.
