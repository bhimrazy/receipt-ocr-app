# Product updates signup (2026-11-08)

A double opt-in list for occasional product updates, held in Resend. Built, and off until the owner sets
`RESEND_NEWSLETTER_SEGMENT_ID` ([production-environment.md](../production-environment.md)).

## Decisions

| Question                | Choice                                                                                                                                                                                                                                                                      |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Table or token?         | **Signed token, no table, so no migration** (migrations need a manual production release). The confirm token carries the address and a 48 hour expiry (HMAC-SHA256, key derived from the auth secret, separate from session signing). The list itself lives only in Resend. |
| Pending state           | None stored. A pending address is just an unused link, so "new", "pending" and "subscribed" all look the same and cost the same: one mail, capped per address (2 an hour) and per IP (5 per 10 minutes).                                                                    |
| No enumeration          | After validation and Turnstile the route always answers `{ ok: true }`. Confirming an existing contact re-subscribes it.                                                                                                                                                    |
| Mail scanners           | Links open a page; only the button (a server action) confirms or unsubscribes, so prefetching changes nothing.                                                                                                                                                              |
| Sign-up checkbox        | Unticked. Ticking it runs the **same double opt-in**: the sign-up hook mails the confirmation. Verifying the address for the account is not consent to marketing, and a typo or a stranger's address would otherwise be subscribed. Costs one click.                        |
| Unsubscribe             | Confirmation mail carries a non-expiring unsubscribe link (`/newsletter/unsubscribe`). It marks the Resend contact unsubscribed (kept, so it isn't re-added by mistake). Broadcasts use Resend's own `{{{RESEND_UNSUBSCRIBE_URL}}}`, which does the same.                   |
| Hidden until configured | No segment id, no form, checkbox or privacy paragraph: nothing promises a list that can't exist.                                                                                                                                                                            |

## Resend (checked in the docs, 2026-11-08)

- Audiences are now **segments**; contacts are global and optional `segments` place them. The Free plan lists 1,000
  contacts, 3 segments, 100 emails a day and 3,000 a month; no broadcast cap is stated on the pricing page. Check the
  dashboard before relying on these.
- Adding contacts needs a **full-access** API key. Whether the existing key is full-access was **not verified** (no key
  in the build environment). Check: `curl -s -o /dev/null -w '%{http_code}\n' -H "Authorization: Bearer $RESEND_API_KEY" https://api.resend.com/segments`
  prints 200 for a full-access key and 401 for a sending-only one.

## Not done

- Broadcasts are sent from the Resend dashboard by hand; nothing in the app sends them.
- Per-contact unsubscribe tokens inside broadcasts (a custom contact property) so they can link to our page.
- Deleting a contact on request is manual (support).
