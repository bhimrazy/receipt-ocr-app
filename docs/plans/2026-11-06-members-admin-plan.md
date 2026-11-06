# Members, seats and permissions plan (2026-11-06)

Recreated from the research agent's report (the original file was never written). Better Auth behaviour verified in the
installed better-auth 1.7.14 source.

## Recommendations

- **Free: 3 seats including the owner; Pro: 10.** Admin-editable as a `members` field in the `plans` setting next to
  receipts/day, per-minute and workspaces. Raising later is easy; lowering after launch hurts. (Market review proposes
  Team: 5 members on a $29 plan — reconcile when plans are decided.)
- **Pending invites count toward seats.** Better Auth ignores expired invites and cancels the old invite on re-invite.
- **Quota per workspace, from the owner's plan**, not per uploader. Today's per-uploader quota lets each extra Free
  member add capacity and lets a Pro member bring Pro limits into a Free workspace. `workspaces` (how many a user may
  own) stays per user. Global `OCR_DAILY_CAP` stays.
- **Exactly one owner per workspace + "Transfer ownership"** (small transaction in core + audit row; Better Auth has no
  transfer endpoint). Leaving uses Better Auth's `leave` (blocks the only owner). Existing co-owned workspaces: oldest
  owner keeps it, others become admin. Optional partial unique index enforcing one owner (production migration).
- **Roles stay owner / admin / member**, matching Better Auth's built-in permissions. One `can(role, action)` map in core
  replaces scattered checks (incl. apps/web/lib/receipt-permissions.ts). A read-only Accountant role is deferred; that
  is when `createAccessControl` is worth adopting.

## Better Auth hooks (verified)

- `membershipLimit` is checked only when an invite is accepted (and on server-side addMember), and receives the
  accepting user — so our function must look up the **owner's** plan.
- `invitationLimit` compares pending invites against a returned **number** (docs say boolean). Return
  `seats − current members` so members + pending ≤ seats.

## Schema / settings

No new tables. Add `members` to the plan schema and the plan-limits form. **Trap:** adding a field without a default
makes every saved plans row fail validation and silently fall back to code defaults, wiping saved limits — merge saved
values over defaults, with a test.

## Edge cases

- Downgrade with too many members: remove nobody; block invites and accepts until under the limit; banner with count.
- Existing bug exposed by leave/transfer: a user who transfers their personal workspace and leaves it — self-heal
  must create a fresh workspace (fixed in #18: fresh slug when the user-id slug is taken, null if any membership).

## Dashboards

- Admin overview: near-limit list by workspace, Free vs Pro counts, workspaces at/over seat limit, OCR failure rate by
  model. Later: billing/MRR, cohorts, cost per receipt, latency (cost/latency now covered by the usage design).
- Customer: home stays upload-first with a workspace usage meter ("you uploaded N" when several members); Members page
  gains a seat line, 30-day receipts per member, Leave and Transfer, "Uploaded by" on receipts.

## Tracks

1. Seat limit as a plan setting + seat counting + UI.
2. Single owner, transfer, leave, permission map.
3. Per-workspace quota (coordinate with the usage track: quota counts from `ocr_calls`).
4. Dashboard additions.
   Tracks 1 and 3 can run in parallel; 4 last.

## Owner decisions

Free seats 3 or 5 (Pro 10); quota per workspace or per uploader; single owner + transfer; pending invites count;
downgrade behaviour; optional one-owner index.
